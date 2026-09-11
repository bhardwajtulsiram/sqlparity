/**
 * SQL syntax validation via dt-sql-parser's real ANTLR grammars.
 *
 * Only three dialect families have an authoritative grammar in the library: Trino,
 * MySQL, and PostgreSQL. There is no dedicated BigQuery, Snowflake, Redshift, Oracle,
 * SQL Server, SQLite, MariaDB, ClickHouse, or Db2 grammar. Rather than validate those
 * against the nearest available grammar and risk confident wrong answers — flagging
 * valid Snowflake syntax as broken, say — validation is simply unavailable for them.
 * `supportsValidation` lets the UI say so honestly instead of silently doing nothing.
 *
 * Athena/Trino is treated as Trino specifically, not Hive: see lib/ddl-parsers.ts for
 * why the two need different grammars for the same dialect.
 */

export interface SyntaxError {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
}

type ValidatorKey = 'trino' | 'mysql' | 'postgresql';

const VALIDATOR_FOR_DIALECT: Record<string, ValidatorKey> = {
  trino: 'trino',
  mysql: 'mysql',
  mariadb: 'mysql',
  tidb: 'mysql',
  postgresql: 'postgresql',
  redshift: 'postgresql',
  duckdb: 'postgresql',
};

function validatorKeyFor(dialectId: string): ValidatorKey | undefined {
  return VALIDATOR_FOR_DIALECT[dialectId];
}

export function supportsValidation(dialectId: string): boolean {
  return validatorKeyFor(dialectId) !== undefined;
}

async function loadValidator(key: ValidatorKey) {
  const mod = await import('./ddl-parsers');
  switch (key) {
    case 'mysql':
      return new mod.MySQL();
    case 'postgresql':
      return new mod.PostgreSQL();
    case 'trino':
      return new mod.TrinoSQL();
  }
}

/**
 * A tiny cache of instantiated parsers, keyed by grammar.
 *
 * Constructing one of these deserializes its ANTLR ATN, which is the expensive part
 * (hundreds of milliseconds). Reusing the instance across calls — repeated keystrokes,
 * or validating both the template and a spot-checked output — means only the first
 * call in a session pays that cost.
 */
const instances = new Map<ValidatorKey, Promise<Awaited<ReturnType<typeof loadValidator>>>>();

function getValidator(key: ValidatorKey) {
  let instance = instances.get(key);
  if (!instance) {
    instance = loadValidator(key);
    instances.set(key, instance);
  }
  return instance;
}

/** Pay the ANTLR initialisation cost now, ideally while the page is otherwise idle. */
export function warmValidator(dialectId: string): void {
  const key = validatorKeyFor(dialectId);
  if (key) getValidator(key).catch(() => undefined);
}

/**
 * Prepare a query template for validation.
 *
 * A template is not valid SQL by itself — `{{name}}` is not a token any grammar
 * recognises — so validating it unmodified would flag every placeholder as an error,
 * which is noise rather than a finding. Each placeholder is replaced with a short,
 * fixed stand-in token: `__x__` where an identifier is legal (the large majority of
 * positions — WHERE clauses, function arguments, column and table references), or `1`
 * immediately after LIMIT or OFFSET, since several grammars — Trino confirmed among
 * them — require a literal integer there, not an identifier.
 *
 * The stand-in is fixed rather than derived from the variable's own name on purpose:
 * a variable named `table` or `key` is a plain English word for its author but a
 * reserved SQL keyword to the grammar, and substituting the bare word back in was
 * caught rejecting this product's own `row-count` preset (`{{table}}`) before it
 * shipped. `__x__` cannot collide with a keyword.
 *
 * Because the stand-in is rarely the same length as the placeholder it replaces,
 * `probeTemplate` also returns `mapOffset`, translating a character offset in the
 * transformed text back to the corresponding offset in the original template — this
 * is what keeps a squiggly underline aligned with the real `{{...}}` text in the
 * editor rather than the position drifting after the first substitution.
 */

interface Substitution {
  origStart: number;
  origEnd: number;
  probeStart: number;
  probeEnd: number;
}

export interface ProbeTemplate {
  probeSql: string;
  /** Offset inside a substituted token maps to that placeholder's opening `{{`. */
  mapOffset: (probeOffset: number) => number;
}

const PLACEHOLDER_RE = /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g;
const IDENTIFIER_TOKEN = '__x__';
const NUMERIC_TOKEN = '1';

function precededByLimitOrOffset(template: string, matchStart: number): boolean {
  return /\b(?:LIMIT|OFFSET)\s*$/i.test(template.slice(0, matchStart));
}

export function probeTemplate(template: string): ProbeTemplate {
  const subs: Substitution[] = [];
  let probeSql = '';
  let lastOrigEnd = 0;

  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    const origStart = match.index;
    const origEnd = origStart + match[0].length;

    probeSql += template.slice(lastOrigEnd, origStart);
    const token = precededByLimitOrOffset(template, origStart) ? NUMERIC_TOKEN : IDENTIFIER_TOKEN;
    const probeStart = probeSql.length;
    probeSql += token;

    subs.push({ origStart, origEnd, probeStart, probeEnd: probeSql.length });
    lastOrigEnd = origEnd;
  }
  probeSql += template.slice(lastOrigEnd);

  function mapOffset(probeOffset: number): number {
    let cursorOrig = 0;
    let cursorProbe = 0;
    for (const sub of subs) {
      const gapLen = sub.probeStart - cursorProbe;
      if (probeOffset <= cursorProbe + gapLen) {
        return cursorOrig + (probeOffset - cursorProbe);
      }
      if (probeOffset < sub.probeEnd) {
        // Inside the synthetic token itself — there is no finer position to give
        // than where the real placeholder starts in the original text.
        return sub.origStart;
      }
      cursorOrig = sub.origEnd;
      cursorProbe = sub.probeEnd;
    }
    return cursorOrig + (probeOffset - cursorProbe);
  }

  return { probeSql, mapOffset };
}

/** Convenience for callers that only need the transformed text, not the position map. */
export function templateToProbeSql(template: string): string {
  return probeTemplate(template).probeSql;
}

export async function validateSql(sql: string, dialectId: string): Promise<SyntaxError[]> {
  if (sql.trim() === '') return [];
  const key = validatorKeyFor(dialectId);
  if (!key) return [];

  const parser = await getValidator(key);
  const errors = parser.validate(sql) ?? [];
  return errors.map((e) => ({
    line: e.startLine,
    column: e.startColumn,
    endLine: e.endLine,
    endColumn: e.endColumn,
    message: e.message,
  }));
}
