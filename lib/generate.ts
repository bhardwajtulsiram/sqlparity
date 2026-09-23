import type { Dialect } from './dialects';
import { escapeStringBody } from './escape';
import { renderName, unquoteName } from './identifiers';
import { replaceToken, scan } from './tokenize';
import { resolveType, type TypeMap } from './typemap';

export const MAX_TEMPLATE_ROWS = 5_000;

/* --------------------------------------------------------------- variables */

export type VariableKind = 'constant' | 'bulk' | 'typed';

export interface Variable {
  name: string;
  kind: VariableKind;
  /** Used when kind is 'constant'. */
  value: string;
  /**
   * When this variable is left blank, take the value of the one named here instead.
   *
   * Both sides of a comparison usually agree — the same column name, the same join
   * key — and only sometimes differ. Declaring the relationship lets the interface
   * offer the output side as an optional field that states what happens when it is
   * skipped, rather than making someone type the same value twice.
   */
  fallbackTo?: string;
  /**
   * The values are names — columns or tables — rather than arbitrary text.
   *
   * Such a value is quoted where the template uses it as a name and it needs quoting
   * (`order`, `Customer Name`), and written as plain text where the template puts it
   * inside a string literal (`'{{field}}' AS field`). Off for anything else, since a
   * value like `12345` is not a name and must never be wrapped in quotes.
   */
  identifier?: boolean;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Every distinct placeholder name in a template, in first-appearance order. */
export function extractPlaceholders(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Turn a literal token in the template into a placeholder.
 *
 * This is the paste-and-highlight path: the user selects `customer_segment`
 * and it becomes `{{field}}` everywhere it appears as a whole token in code — never
 * inside `customer_segment_range`, a string literal or a comment.
 */
export function markVariable(
  template: string,
  token: string,
  variableName: string,
  dialect: Dialect,
): string {
  return replaceToken(template, token, `{{${variableName}}}`, dialect);
}

/**
 * Substitute bindings, writing name values the way each position in the template needs.
 *
 * The same `{{field}}` can appear as a column reference (`a.{{field}}`), inside a
 * string literal (`'{{field}}' AS field`) and inside quotes the author wrote
 * themselves (`"{{field}}"`). Each wants the name differently, so the template is read
 * with the dialect's scanner and each placeholder is filled for where it sits.
 */
export function bindTemplate(
  template: string,
  bindings: Record<string, string>,
  names: ReadonlySet<string>,
  dialect: Dialect,
): string {
  if (names.size === 0) return applyBindings(template, bindings);
  return scan(template, dialect)
    .map((segment) =>
      segment.text.replace(PLACEHOLDER, (whole, name: string) => {
        if (!Object.prototype.hasOwnProperty.call(bindings, name)) return whole;
        const value = bindings[name]!;
        if (!names.has(name)) return value;
        const bare = unquoteName(value.trim(), dialect);
        if (segment.kind === 'string') return escapeStringBody(bare, dialect);
        if (segment.kind === 'identifier') {
          const { close, escapeClose } = dialect.identifier;
          return bare.replaceAll(close, escapeClose);
        }
        return renderName(value, dialect);
      }),
    )
    .join('');
}

/** Substitute a full set of bindings. Unknown placeholders are left untouched. */
export function applyBindings(template: string, bindings: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(bindings, name) ? bindings[name]! : whole,
  );
}

/* ------------------------------------------------------------------- input */

/** Reserved column role: supplies the data type that typed variables resolve through. */
export const TYPE_COLUMN = '__type__';
/** Reserved column role: column is present in the paste but not used. */
export const IGNORED_COLUMN = '';

export type IterationMode = 'rowwise' | 'cartesian' | 'single';

export interface GenerateInput {
  template: string;
  variables: Variable[];
  dialect: Dialect;
  typeMap: TypeMap;
  mode: IterationMode;
  /** Role for each column of the pasted grid: a variable name, TYPE_COLUMN, or ''. */
  columns: string[];
  rows: string[][];
  /** For cartesian mode: one list of values per variable name. */
  lists: Record<string, string[]>;
}

export interface GeneratedQuery {
  index: number;
  sql: string;
  /** The bulk value this query is for — used as the row label in exports. */
  label: string;
  dataType: string;
}

export interface GenerateProblem {
  level: 'block' | 'warn';
  message: string;
}

export interface GenerateResult {
  queries: GeneratedQuery[];
  problems: GenerateProblem[];
  /** True when a blocking problem stopped generation. */
  blocked: boolean;
}

/* -------------------------------------------------------------- generation */

function bulkVariables(variables: Variable[]): Variable[] {
  return variables.filter((v) => v.kind === 'bulk');
}

function cartesianProduct(names: string[], lists: Record<string, string[]>): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const name of names) {
    const values = lists[name] ?? [];
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of values) next.push({ ...combo, [name]: value });
    }
    combos = next;
  }
  return combos;
}

export function generate(input: GenerateInput): GenerateResult {
  const { template, variables, dialect, typeMap, mode, columns, rows, lists } = input;
  const problems: GenerateProblem[] = [];

  if (template.trim() === '') {
    return { queries: [], problems, blocked: false };
  }

  const placeholders = extractPlaceholders(template);
  const declared = new Set(variables.map((v) => v.name));

  for (const name of placeholders) {
    if (!declared.has(name)) {
      problems.push({
        level: 'block',
        message: `The template uses {{${name}}} but no variable named "${name}" is defined.`,
      });
    }
  }
  // One line, not one per variable: a template that uses none of them would otherwise
  // produce a stack of near-identical warnings that bury the real problem.
  const unused = variables.filter((v) => !placeholders.includes(v.name));
  if (unused.length > 0) {
    problems.push({
      level: 'warn',
      message:
        unused.length === variables.length && variables.length > 1
          ? `The template uses none of the variables (${unused.map((v) => `{{${v.name}}}`).join(', ')}), so every generated query is identical.`
          : `Defined but not used in the template: ${unused.map((v) => `{{${v.name}}}`).join(', ')}.`,
    });
  }

  const typedVars = variables.filter((v) => v.kind === 'typed');
  const bulk = bulkVariables(variables);
  const constants = variables.filter((v) => v.kind === 'constant');

  const hasTypeColumn = columns.includes(TYPE_COLUMN);
  if (typedVars.length > 0 && mode !== 'cartesian' && !hasTypeColumn) {
    problems.push({
      level: 'block',
      message: `The template has a typed variable (${typedVars
        .map((v) => `{{${v.name}}}`)
        .join(', ')}) but no column is marked as the data type. Add a data-type column to your paste.`,
    });
  }

  if (problems.some((p) => p.level === 'block')) {
    return { queries: [], problems, blocked: true };
  }

  const base: Record<string, string> = {};
  for (const constant of constants) base[constant.name] = constant.value;

  const queries: GeneratedQuery[] = [];
  /** Missing type -> the columns skipped because of it. */
  const skipped = new Map<string, string[]>();
  let unsentinelable = false;
  const names = new Set(variables.filter((v) => v.identifier).map((v) => v.name));

  const emit = (bindings: Record<string, string>, dataType: string, label: string) => {
    const resolved: Record<string, string> = { ...base, ...bindings };

    for (const typed of typedVars) {
      const outcome = resolveType(dataType, typeMap);
      if (outcome.missing !== undefined) {
        skipped.set(outcome.missing, [...(skipped.get(outcome.missing) ?? []), label]);
        if (outcome.unsentinelable) unsentinelable = true;
        return;
      }
      resolved[typed.name] = outcome.value!;
    }

    queries.push({
      index: queries.length + 1,
      sql: bindTemplate(template, resolved, names, dialect),
      label,
      dataType,
    });
  };

  if (mode === 'cartesian') {
    const names = bulk.map((v) => v.name);
    for (const combo of cartesianProduct(names, lists)) {
      const label = names.map((n) => combo[n] ?? '').join(' × ');
      emit(combo, '', label);
    }
  } else {
    const typeIndex = columns.indexOf(TYPE_COLUMN);
    for (const row of rows) {
      if (row.every((cell) => cell.trim() === '')) continue;

      // Pasted cells carry stray spaces and carriage returns; a name is never meant
      // to include them.
      const bindings: Record<string, string> = {};
      columns.forEach((role, i) => {
        if (role === IGNORED_COLUMN || role === TYPE_COLUMN) return;
        bindings[role] = (row[i] ?? '').trim();
      });

      const dataType = typeIndex === -1 ? '' : (row[typeIndex] ?? '').trim();
      const first = bulk[0];
      const rawLabel = first ? (bindings[first.name] ?? '') : (row[0] ?? '').trim();
      const label = first?.identifier ? unquoteName(rawLabel, dialect) : rawLabel;

      // A row with no name is not a column to check, even when the other cells on
      // that row are filled — a blank line in the name list paired with a type would
      // otherwise produce a query against a nameless column.
      if (first && label.trim() === '') continue;

      emit(bindings, dataType, label);
    }
  }

  // A column whose type has no sentinel is skipped, not guessed at — and not allowed
  // to stop the other 399 columns either. The message names every one, so nothing is
  // dropped silently.
  if (skipped.size > 0) {
    const types = [...skipped.keys()].sort();
    const columnsSkipped = types.flatMap((t) => skipped.get(t)!);
    const detail = types
      .map((t) => {
        const cols = skipped.get(t)!;
        const shown = cols.slice(0, 5).join(', ') + (cols.length > 5 ? ` and ${cols.length - 5} more` : '');
        return `"${t}" (${shown})`;
      })
      .join('; ');
    const advice = unsentinelable
      ? ' Collections, documents and binary columns have no safe stand-in value — the null-safe comparison preset checks them correctly.'
      : '';
    problems.push({
      level: queries.length === 0 ? 'block' : 'warn',
      message: `Skipped ${columnsSkipped.length} column${columnsSkipped.length === 1 ? '' : 's'} with no type-map entry for ${dialect.label}: ${detail}. Add the type to your type map to include ${columnsSkipped.length === 1 ? 'it' : 'them'} — generating with a guessed value would produce queries that run but report the wrong answer.${advice}`,
    });
    if (queries.length === 0) return { queries: [], problems, blocked: true };
  }

  if (queries.length > MAX_TEMPLATE_ROWS) {
    problems.push({
      level: 'warn',
      message: `${queries.length.toLocaleString()} queries is above the ${MAX_TEMPLATE_ROWS.toLocaleString()} this tool is built for. Everything still works, but the page may become slow.`,
    });
  }

  return { queries, problems, blocked: false };
}

/* --------------------------------------------------------------- row input */

export interface ParsedGrid {
  rows: string[][];
  columnCount: number;
}

/** Split a pasted block into a grid. Tabs win where present, otherwise commas. */
export function parseGrid(input: string): ParsedGrid {
  const text = input.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (text.trim() === '') return { rows: [], columnCount: 0 };

  const lines = text.split('\n');
  const delimiter = text.includes('\t') ? '\t' : text.includes(',') ? ',' : null;

  const rows = lines.map((line) =>
    delimiter === null ? [line] : line.split(delimiter).map((cell) => cell.trim()),
  );
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return { rows, columnCount };
}
