import type { Dialect } from './dialects';
import { scan } from './tokenize';

/**
 * Check a converted query on a real database engine, inside the tab.
 *
 * Three engines can run in a browser: DuckDB, PostgreSQL (PGlite) and SQLite. When
 * the converter's target is one of them, the converted query is run for real; when
 * the source is one too, the original runs alongside it on the same sample data and
 * the two results are compared. Everything here is pure — the engines themselves
 * live in lib/engines.ts — so it is tested without a browser.
 *
 * The sample data is guessed from the query: which tables it reads, which columns it
 * names, and what type each column must be for the query to make sense. The guess is
 * shown as editable SQL, because a guess that cannot be corrected would turn a type
 * mismatch in the guess into a false "your query is broken".
 */

export type EngineId = 'postgres' | 'sqlite' | 'duckdb';

const ENGINE_BY_DIALECT: Record<string, EngineId> = {
  postgresql: 'postgres',
  sqlite: 'sqlite',
  duckdb: 'duckdb',
};

export const ENGINE_LABEL: Record<EngineId, string> = {
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  duckdb: 'DuckDB',
};

/** The engine that runs this dialect for real, or null when none runs in a browser. */
export function engineFor(dialectId: string): EngineId | null {
  return ENGINE_BY_DIALECT[dialectId] ?? null;
}

/* ------------------------------------------------------------------- tokens */

type TokenKind = 'name' | 'string' | 'number' | 'punct';

interface Token {
  kind: TokenKind;
  /** For names, the name itself with any quoting removed. */
  value: string;
  /** Upper-cased value, for keyword checks. Empty for quoted names. */
  upper: string;
  quoted: boolean;
  /** The token exactly as written, for reusing literals as sample values. */
  raw: string;
}

const CODE_TOKEN = /\s+|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_$]*)|(::|<>|!=|>=|<=|\|\||[(),.;=<>*+\-/%])|./g;

function unquote(text: string): string {
  const open = text[0];
  const close = open === '[' ? ']' : open;
  const inner = text.slice(1, text.endsWith(close) && text.length > 1 ? -1 : undefined);
  return inner.replaceAll(close + close, close);
}

export function tokenize(sql: string, dialect: Dialect): Token[] {
  const tokens: Token[] = [];
  for (const segment of scan(sql, dialect)) {
    if (segment.kind === 'comment') continue;
    if (segment.kind === 'string') {
      tokens.push({ kind: 'string', value: segment.text, upper: '', quoted: false, raw: segment.text });
      continue;
    }
    if (segment.kind === 'identifier') {
      tokens.push({ kind: 'name', value: unquote(segment.text), upper: '', quoted: true, raw: segment.text });
      continue;
    }
    for (const match of segment.text.matchAll(CODE_TOKEN)) {
      const [text, number, word, punct] = match;
      if (number) tokens.push({ kind: 'number', value: number, upper: number, quoted: false, raw: number });
      else if (word) tokens.push({ kind: 'name', value: word, upper: word.toUpperCase(), quoted: false, raw: word });
      else if (punct) tokens.push({ kind: 'punct', value: punct, upper: punct, quoted: false, raw: punct });
      else if (text.trim() !== '') tokens.push({ kind: 'punct', value: text, upper: text, quoted: false, raw: text });
    }
  }
  return tokens;
}

/**
 * Words that are never a column, unquoted. Not every SQL keyword — only the ones a
 * SELECT is likely to contain where a column name could otherwise be expected.
 */
const KEYWORDS = new Set(
  `SELECT FROM WHERE AND OR NOT NULL IS IN LIKE ILIKE BETWEEN CASE WHEN THEN ELSE END AS ON
  JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL USING GROUP BY ORDER ASC DESC LIMIT OFFSET
  FETCH NEXT FIRST LAST ONLY ROWS ROW TOP PERCENT DISTINCT ALL ANY SOME UNION INTERSECT EXCEPT
  EXISTS HAVING WINDOW OVER PARTITION RANGE PRECEDING FOLLOWING UNBOUNDED CURRENT FILTER NULLS
  WITH RECURSIVE TRUE FALSE INTERVAL DATE TIME TIMESTAMP CURRENT_DATE CURRENT_TIME
  CURRENT_TIMESTAMP LOCALTIME LOCALTIMESTAMP CURRENT_USER SESSION_USER QUALIFY ESCAPE COLLATE
  VALUES LATERAL TABLESAMPLE ZONE AT VARCHAR TEXT INTEGER INT BIGINT SMALLINT NUMERIC DECIMAL
  REAL DOUBLE PRECISION FLOAT BOOLEAN CHAR CHARACTER VARYING YEAR MONTH DAY HOUR MINUTE SECOND
  SYSDATE`.split(/\s+/),
);

/** Words that end a table reference, so they are never read as its alias. */
const NOT_ALIAS = new Set(
  `WHERE JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ON USING GROUP ORDER LIMIT OFFSET FETCH
  UNION INTERSECT EXCEPT HAVING WINDOW QUALIFY TABLESAMPLE AS SET WITH`.split(/\s+/),
);

/** Functions inside whose parentheses FROM is an argument separator, not a clause. */
const FROM_INSIDE = new Set(['EXTRACT', 'SUBSTRING', 'TRIM', 'POSITION', 'OVERLAY']);

/* ------------------------------------------------------------------- schema */

export type SqlType = 'TEXT' | 'NUMERIC' | 'DATE' | 'TIMESTAMP' | 'BOOLEAN';

export interface NamePart {
  value: string;
  quoted: boolean;
}

export interface InferredColumn {
  name: NamePart;
  type: SqlType;
  /** Literals the query compares this column with, reused as sample values. */
  examples: string[];
}

export interface InferredTable {
  /** Schema then table, as the query names it. */
  parts: NamePart[];
  columns: InferredColumn[];
}

const TEXT_FUNCTIONS = new Set(
  'LENGTH LEN CHAR_LENGTH CHARACTER_LENGTH UPPER LOWER TRIM LTRIM RTRIM SUBSTR SUBSTRING CONCAT REPLACE LEFT RIGHT STRPOS INSTR LPAD RPAD SPLIT_PART INITCAP REVERSE'.split(' '),
);
const NUMBER_FUNCTIONS = new Set('SUM AVG ROUND ABS FLOOR CEIL CEILING STDDEV VARIANCE POWER SQRT MOD'.split(' '));
const TIME_FUNCTIONS = new Set('DATE_TRUNC DATE_PART EXTRACT DATEDIFF DATEADD DATE_ADD DATE_SUB TO_CHAR YEAR MONTH DAY'.split(' '));
const NOW_WORDS = new Set(['CURRENT_TIMESTAMP', 'NOW', 'GETDATE', 'LOCALTIMESTAMP', 'SYSDATE', 'SYSDATETIME']);
const COMPARISON = new Set(['=', '<>', '!=', '<', '>', '<=', '>=']);

/** A type from a column's name alone, when the query gives no better clue. */
export function typeFromName(name: string): SqlType {
  const n = name.toLowerCase();
  if (/(^|_)(is|has|can|should)_|^(active|enabled|deleted|flag)$/.test(n)) return 'BOOLEAN';
  if (/(_at|_ts|timestamp|_time|datetime)$|^(created|updated|modified)$/.test(n)) return 'TIMESTAMP';
  if (/(date|_dt|^dt|_day)$/.test(n)) return 'DATE';
  if (/(amount|total|price|cost|qty|quantity|count|_num|number|score|rate|balance|value|age|size|weight|sum|avg)$/.test(n)) {
    return 'NUMERIC';
  }
  return 'TEXT';
}

function literalType(token: Token | undefined, next: Token | undefined): { type: SqlType; example?: string } | null {
  if (!token) return null;
  if (token.kind === 'string') {
    const text = token.value.slice(1, -1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { type: 'DATE', example: token.raw };
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) return { type: 'TIMESTAMP', example: token.raw };
    return { type: 'TEXT', example: token.raw };
  }
  if (token.kind === 'number') return { type: 'NUMERIC', example: token.raw };
  if (token.kind === 'name' && !token.quoted) {
    if ((token.upper === 'DATE' || token.upper === 'TIMESTAMP') && next?.kind === 'string') {
      return { type: token.upper, example: next.raw };
    }
    if (NOW_WORDS.has(token.upper)) return { type: 'TIMESTAMP' };
    if (token.upper === 'CURRENT_DATE') return { type: 'DATE' };
    if (token.upper === 'TRUE' || token.upper === 'FALSE') return { type: 'BOOLEAN', example: token.upper };
  }
  return null;
}

/**
 * A comparison against the current time has no literal to reuse, and a fixed sample
 * date would land on the wrong side of `created_at > now()` forever. Pick a sample
 * on the side the query asks for, so the row it should return is there.
 */
function relativeToNow(
  found: { type: SqlType; example?: string },
  operator: string,
  order: 'column-first' | 'column-last',
): { type: SqlType; example?: string } {
  if (found.example || (found.type !== 'TIMESTAMP' && found.type !== 'DATE')) return found;
  const wantsLater = order === 'column-first' ? operator.startsWith('>') : operator.startsWith('<');
  const wantsEarlier = order === 'column-first' ? operator.startsWith('<') : operator.startsWith('>');
  if (!wantsLater && !wantsEarlier) return found;
  const day = wantsLater ? '2099-12-31' : '2000-01-01';
  return { type: found.type, example: found.type === 'DATE' ? `'${day}'` : `'${day} 00:00:00'` };
}

const key = (part: NamePart) => (part.quoted ? part.value : part.value.toLowerCase());

/**
 * Work out the tables a query reads and the columns it needs from each.
 *
 * Not a parser, and does not need to be: it only has to produce a schema the query
 * can run against. Qualified column references go to the table their qualifier
 * names; unqualified ones go to the first table, which is right for single-table
 * queries and a reasonable starting point for the editable setup otherwise.
 */
export function inferSchema(sql: string, dialect: Dialect): InferredTable[] {
  const tokens = tokenize(sql, dialect);
  const tables = new Map<string, InferredTable>();
  const aliases = new Map<string, string>();
  const ctes = new Set<string>();
  const consumed = new Set<number>();

  const isName = (t: Token | undefined) => t?.kind === 'name';
  const is = (t: Token | undefined, value: string) => t?.kind === 'punct' ? t.value === value : t?.upper === value;

  // Function name for each open parenthesis, so FROM inside EXTRACT(… FROM …) is
  // not mistaken for a table clause and arguments know their enclosing function.
  const enclosing: (string | null)[] = new Array(tokens.length).fill(null);
  {
    const stack: (string | null)[] = [];
    tokens.forEach((t, i) => {
      if (is(t, '(')) {
        const before = tokens[i - 1];
        stack.push(before && isName(before) && !before.quoted ? before.upper : null);
      } else if (is(t, ')')) {
        stack.pop();
      }
      enclosing[i] = stack.length > 0 ? stack[stack.length - 1]! : null;
    });
  }

  // CTE names: `name AS (` after WITH or a comma.
  tokens.forEach((t, i) => {
    if (isName(t) && is(tokens[i + 1], 'AS') && is(tokens[i + 2], '(')) {
      const prev = tokens[i - 1];
      if (is(prev, 'WITH') || is(prev, ',') || is(prev, 'RECURSIVE')) {
        ctes.add(key(t));
        consumed.add(i);
      }
    }
  });

  const skipParens = (start: number): number => {
    let depth = 0;
    for (let j = start; j < tokens.length; j++) {
      if (is(tokens[j], '(')) depth++;
      else if (is(tokens[j], ')')) {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return tokens.length;
  };

  /**
   * Read one table reference starting at j and return the index after it. The alias
   * (or the bare name) is wired to the table it stands for; a subquery or CTE maps to
   * '', so columns qualified by it are left to the query that defines them.
   */
  const readTableRef = (j: number): number => {
    let at = j;
    let refKey = '';
    if (is(tokens[at], 'LATERAL')) at++;
    if (is(tokens[at], '(')) {
      at = skipParens(at);
    } else if (isName(tokens[at])) {
      const parts: NamePart[] = [];
      for (;;) {
        consumed.add(at);
        parts.push({ value: tokens[at]!.value, quoted: tokens[at]!.quoted });
        if (is(tokens[at + 1], '.') && isName(tokens[at + 2])) at += 2;
        else break;
      }
      at++;
      if (is(tokens[at], '(')) {
        // A table function such as generate_series(…): nothing to create.
        at = skipParens(at);
      } else {
        const tableKey = parts.map(key).join('.');
        const isCte = parts.length === 1 && ctes.has(key(parts[0]!));
        if (!isCte) {
          if (!tables.has(tableKey)) tables.set(tableKey, { parts, columns: [] });
          refKey = tableKey;
        }
        aliases.set(tableKey, refKey);
        aliases.set(key(parts[parts.length - 1]!), refKey);
      }
    } else {
      return at;
    }

    if (is(tokens[at], 'AS') && isName(tokens[at + 1])) {
      consumed.add(at + 1);
      aliases.set(key(tokens[at + 1]!), refKey);
      return at + 2;
    }
    const maybe = tokens[at];
    if (isName(maybe) && (maybe!.quoted || (!NOT_ALIAS.has(maybe!.upper) && !KEYWORDS.has(maybe!.upper)))) {
      consumed.add(at);
      aliases.set(key(maybe!), refKey);
      return at + 1;
    }
    return at;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!isName(t) || t.quoted) continue;
    if (t.upper === 'FROM' && enclosing[i] && FROM_INSIDE.has(enclosing[i]!)) continue;
    if (t.upper !== 'FROM' && t.upper !== 'JOIN') continue;
    let at = readTableRef(i + 1);
    if (t.upper === 'FROM') {
      while (is(tokens[at], ',')) at = readTableRef(at + 1);
    }
  }

  const tableList = [...tables.values()];
  if (tableList.length === 0) return [];

  const addColumn = (tableKey: string, token: Token, index: number) => {
    const table = tables.get(tableKey);
    if (!table) return;
    const name: NamePart = { value: token.value, quoted: token.quoted };
    let column = table.columns.find((c) => key(c.name) === key(name));
    if (!column) {
      column = { name, type: typeFromName(name.value), examples: [] };
      (column as InferredColumn & { fromUsage?: boolean }).fromUsage = false;
      table.columns.push(column);
    }
    const usage = usageType(index);
    const tagged = column as InferredColumn & { fromUsage?: boolean };
    if (usage) {
      if (!tagged.fromUsage) {
        column.type = usage.type;
        tagged.fromUsage = true;
      }
      if (usage.example && usage.type === column.type && !column.examples.includes(usage.example)) {
        column.examples.push(usage.example);
      }
    }
  };

  /** What the tokens around a column say about its type. */
  const usageType = (i: number): { type: SqlType; example?: string } | null => {
    // Skip back over a qualifier so `o.total > 5` reads the same as `total > 5`.
    let start = i;
    while (is(tokens[start - 1], '.') && isName(tokens[start - 2])) start -= 2;
    const after = tokens[i + 1];
    const before = tokens[start - 1];

    if (after && COMPARISON.has(after.value)) {
      const found = literalType(tokens[i + 2], tokens[i + 3]);
      if (found) return relativeToNow(found, after.value, 'column-first');
    }
    if (before && COMPARISON.has(before.value)) {
      const lit = tokens[start - 2];
      const found = literalType(lit, tokens[start - 1]);
      if (found) return relativeToNow(found, before.value, 'column-last');
      // DATE '…' = col: the keyword sits two back.
      const keyword = tokens[start - 3];
      if (keyword && lit?.kind === 'string') {
        const viaKeyword = literalType(keyword, lit);
        if (viaKeyword) return viaKeyword;
      }
    }
    if (is(after, 'LIKE') || is(after, 'ILIKE') || (is(after, 'NOT') && (is(tokens[i + 2], 'LIKE') || is(tokens[i + 2], 'ILIKE')))) {
      return { type: 'TEXT' };
    }
    if (is(after, 'IN') && is(tokens[i + 2], '(')) {
      const found = literalType(tokens[i + 3], tokens[i + 4]);
      if (found) return found;
    }
    if (is(after, 'BETWEEN')) {
      const found = literalType(tokens[i + 2], tokens[i + 3]);
      if (found) return found;
    }
    if (after && ['+', '-', '*', '/', '%'].includes(after.value) && tokens[i + 2]?.kind === 'number') {
      return { type: 'NUMERIC' };
    }
    const fn = enclosing[i];
    if (fn && TEXT_FUNCTIONS.has(fn)) return { type: 'TEXT' };
    if (fn && NUMBER_FUNCTIONS.has(fn)) return { type: 'NUMERIC' };
    if (fn && TIME_FUNCTIONS.has(fn)) return { type: 'TIMESTAMP' };
    return null;
  };

  const firstTable = [...tables.keys()][0]!;
  const tableNames = new Set([...tables.keys(), ...aliases.keys(), ...ctes]);

  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const t = tokens[i]!;
    if (!isName(t)) continue;

    // qualifier.column (or schema.table.column)
    if (is(tokens[i + 1], '.') && (isName(tokens[i + 2]) || is(tokens[i + 2], '*'))) {
      let at = i;
      const chain: Token[] = [t];
      while (is(tokens[at + 1], '.') && isName(tokens[at + 2])) {
        chain.push(tokens[at + 2]!);
        at += 2;
      }
      for (let x = i; x <= at; x++) consumed.add(x);
      if (is(tokens[at + 1], '.') && is(tokens[at + 2], '*')) continue;
      if (is(tokens[at + 1], '(')) continue; // schema.function(…)
      const column = chain[chain.length - 1]!;
      const qualifier = chain.slice(0, -1);
      const qualifierKey = qualifier.map((p) => key(p)).join('.');
      const tableKey = aliases.get(qualifierKey) ?? aliases.get(key(qualifier[qualifier.length - 1]!));
      if (tableKey) addColumn(tableKey, column, at);
      continue;
    }

    const prev = tokens[i - 1];
    if (is(prev, 'AS') || is(prev, '::') || is(prev, '.')) continue;
    if (is(tokens[i + 1], '(')) continue;
    if (!t.quoted && KEYWORDS.has(t.upper)) continue;
    if (tableNames.has(key(t))) continue;
    addColumn(firstTable, t, i);
  }

  for (const table of tableList) {
    for (const column of table.columns) delete (column as InferredColumn & { fromUsage?: boolean }).fromUsage;
  }
  return tableList;
}

/* -------------------------------------------------------------------- setup */

/** Quote a name for the setup script. Unquoted names fold to lower case, as Postgres does. */
export function setupName(part: NamePart): string {
  const value = part.quoted ? part.value : part.value.toLowerCase();
  return `"${value.replaceAll('"', '""')}"`;
}

const DEFAULTS: Record<SqlType, string[]> = {
  TEXT: ["'alpha'", "'beta'"],
  NUMERIC: ['10', '2.5'],
  DATE: ["'2026-01-15'", "'2026-02-01'"],
  TIMESTAMP: ["'2026-01-15 09:30:00'", "'2026-02-01 18:00:00'"],
  BOOLEAN: ['TRUE', 'FALSE'],
};

/** Sample rows per table: one built from the query's own literals, one plain, one all NULL. */
export const SAMPLE_ROWS = 3;

function sampleValue(column: InferredColumn, row: number): string {
  if (row === SAMPLE_ROWS - 1) return 'NULL';
  const fromQuery = column.examples[row];
  if (fromQuery) {
    // DATE '2026-01-01' in the query becomes a plain string here, which every engine
    // casts on insert — SQLite has no typed literal to accept the keyword form.
    return fromQuery;
  }
  return DEFAULTS[column.type][row] ?? 'NULL';
}

/**
 * A setup script every runnable engine accepts: CREATE SCHEMA, CREATE TABLE with
 * plain portable types, and INSERT of three rows. SQLite has no CREATE SCHEMA; the
 * engine layer turns that line into an ATTACH, which does the same job there.
 */
export function renderSetup(tables: InferredTable[]): string {
  if (tables.length === 0) return '';
  const lines: string[] = [
    '-- Guessed from the query. Edit the types or rows to match your real tables.',
  ];
  const schemas = new Set<string>();
  for (const table of tables) {
    if (table.parts.length > 1) {
      const schema = table.parts.slice(0, -1).map(setupName).join('.');
      if (!schemas.has(schema)) {
        schemas.add(schema);
        lines.push(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
      }
    }
  }
  for (const table of tables) {
    const name = table.parts.map(setupName).join('.');
    const columns = table.columns.length > 0 ? table.columns : [{ name: { value: 'id', quoted: false }, type: 'NUMERIC' as SqlType, examples: [] }];
    lines.push('');
    lines.push(`CREATE TABLE ${name} (`);
    lines.push(columns.map((c, i) => `  ${setupName(c.name)} ${c.type}${i < columns.length - 1 ? ',' : ''}`).join('\n'));
    lines.push(');');
    lines.push(`INSERT INTO ${name} (${columns.map((c) => setupName(c.name)).join(', ')}) VALUES`);
    const rows: string[] = [];
    for (let r = 0; r < SAMPLE_ROWS; r++) {
      rows.push(`  (${columns.map((c) => sampleValue(c, r)).join(', ')})`);
    }
    lines.push(rows.join(',\n') + ';');
  }
  return lines.join('\n');
}

/** The setup script for one engine: SQLite gets ATTACH in place of CREATE SCHEMA. */
export function setupFor(engine: EngineId, setup: string): string {
  if (engine !== 'sqlite') return setup;
  return setup.replace(
    /CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?("(?:[^"]|"")+"|\w+)\s*;/gi,
    (_m, name: string) => `ATTACH ':memory:' AS ${name};`,
  );
}

/* --------------------------------------------------------------- comparison */

export interface EngineRows {
  columns: string[];
  rows: unknown[][];
}

/** True when the query sorts its own output, so row order is part of the answer. */
export function isOrdered(sql: string, dialect: Dialect): boolean {
  const tokens = tokenize(sql, dialect);
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'punct' && t.value === '(') depth++;
    else if (t.kind === 'punct' && t.value === ')') depth--;
    else if (depth === 0 && t.upper === 'ORDER' && tokens[i + 1]?.upper === 'BY') return true;
  }
  return false;
}

const DATETIME = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * One cell as a canonical string, so engines that agree on the value also agree on
 * the text. Postgres says `t`, SQLite says 1; Postgres writes `10.50`, DuckDB `10.5`;
 * a midnight timestamp is the same instant with or without its `00:00:00`.
 */
export function normaliseCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return canonicalNumber(value);
  if (value instanceof Date) return canonicalDate(value.toISOString());
  if (value instanceof Uint8Array) return `x${[...value].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  if (typeof value === 'object') return JSON.stringify(value);

  const text = String(value);
  if (text === 't' || text === 'true') return '1';
  if (text === 'f' || text === 'false') return '0';
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) return canonicalNumber(Number(text));
  if (DATETIME.test(text)) return canonicalDate(text);
  return text;
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

function canonicalDate(text: string): string {
  const match = DATETIME.exec(text);
  if (!match) return text;
  const [, day, time] = match;
  return !time || time === '00:00:00' ? day! : `${day} ${time}`;
}

export interface Comparison {
  same: boolean;
  /** Set when the two results do not even have the same number of columns. */
  columnCountDiffers: boolean;
  onlyLeft: string[][];
  onlyRight: string[][];
}

/**
 * Compare two results as an answer, not as text.
 *
 * Without ORDER BY a database may return rows in any order, so the rows are compared
 * as a multiset; with one, order is part of the answer and is compared too. Column
 * names are not compared — a converter is allowed to change how an alias is quoted.
 */
export function compareResults(left: EngineRows, right: EngineRows, ordered: boolean): Comparison {
  if (left.columns.length !== right.columns.length) {
    return { same: false, columnCountDiffers: true, onlyLeft: [], onlyRight: [] };
  }
  const l = left.rows.map((r) => r.map(normaliseCell));
  const r = right.rows.map((row) => row.map(normaliseCell));

  if (ordered) {
    const onlyLeft: string[][] = [];
    const onlyRight: string[][] = [];
    const n = Math.max(l.length, r.length);
    for (let i = 0; i < n; i++) {
      const a = l[i];
      const b = r[i];
      if (a && b && a.join('\u0000') === b.join('\u0000')) continue;
      if (a) onlyLeft.push(a);
      if (b) onlyRight.push(b);
    }
    return { same: onlyLeft.length === 0 && onlyRight.length === 0, columnCountDiffers: false, onlyLeft, onlyRight };
  }

  const counts = new Map<string, number>();
  for (const row of l) counts.set(row.join('\u0000'), (counts.get(row.join('\u0000')) ?? 0) + 1);
  const onlyRight: string[][] = [];
  for (const row of r) {
    const k = row.join('\u0000');
    const c = counts.get(k) ?? 0;
    if (c > 0) counts.set(k, c - 1);
    else onlyRight.push(row);
  }
  const onlyLeft: string[][] = [];
  for (const row of l) {
    const k = row.join('\u0000');
    const c = counts.get(k) ?? 0;
    if (c > 0) {
      onlyLeft.push(row);
      counts.set(k, c - 1);
    }
  }
  return { same: onlyLeft.length === 0 && onlyRight.length === 0, columnCountDiffers: false, onlyLeft, onlyRight };
}
