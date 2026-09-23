/**
 * DDL parsing: paste a CREATE TABLE statement, get its columns and their types.
 *
 * This is the step that turns "hand-assemble 400 field names and types into a
 * spreadsheet" into "paste the DDL".
 *
 * It is a purpose-built reader rather than a grammar. The job is narrow — find the
 * column list, split it into columns, and read each one's name and declared type — and
 * a full grammar does that job worse: each one only knows its own dialect, so real
 * DDL from anywhere else (`timestamp(6)` in Athena, `ENCODE az64` in Redshift,
 * `[nvarchar](max)` from SQL Server, `VARCHAR2(20 BYTE)` from Oracle) stopped the
 * parse part-way and silently dropped every column after it. A reader that only needs
 * to understand brackets, quotes and commas has no such cliff.
 *
 * What it relies on is small and common to every dialect: the column list is the
 * first top-level parenthesised group after the table name, columns are separated by
 * commas outside brackets, and a column is its name followed by its type, followed by
 * options that start with a recognisable keyword (NOT NULL, DEFAULT, COMMENT, …).
 */

export interface DdlColumn {
  /** The column's name, without any quoting it was written with. */
  name: string;
  /** The declared type as written, e.g. `varchar(50)` or `array<int>`, whitespace collapsed. */
  type: string;
  /** 1-based line the column is declared on. */
  line: number;
  /** True when the source wrapped the name in quotes, backticks or brackets. */
  quoted?: boolean;
  /** Declared NOT NULL. */
  notNull?: boolean;
  /** The DEFAULT expression, as written. */
  defaultValue?: string;
  /** A COLLATE clause, as written. */
  collation?: string;
  /** Declared in PARTITIONED BY rather than the column list (Hive, Athena, Spark). */
  partition?: boolean;
}

export interface DdlError {
  line: number;
  column: number;
  message: string;
}

export interface DdlParseResult {
  table?: string;
  columns: DdlColumn[];
  /** Parts that could not be read. Any here means the column list may be incomplete. */
  errors: DdlError[];
  /** Things worth knowing that do not affect the columns read. */
  notes?: string[];
}

/* ------------------------------------------------------------------- tokens */

type TokenKind = 'word' | 'quoted' | 'string' | 'number' | 'punct';

interface Token {
  kind: TokenKind;
  /** Source text. */
  text: string;
  /** For quoted identifiers: the name inside the quotes. Otherwise the text. */
  value: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

/** Dialects where `#` starts a line comment. Elsewhere it is an ordinary character. */
const HASH_COMMENTS = new Set(['mysql', 'mariadb', 'bigquery']);
/**
 * Dialects where a backslash escapes the next character inside a string. Athena is
 * here although its queries are Trino: its CREATE TABLE is Hive DDL, where
 * `COMMENT 'customer\'s id'` is how an apostrophe is written.
 */
const BACKSLASH_STRINGS = new Set([
  'trino',
  'mysql',
  'mariadb',
  'bigquery',
  'hive',
  'spark',
  'snowflake',
  'redshift',
  'clickhouse',
]);

function tokenize(sql: string, dialectId: string): Token[] {
  const tokens: Token[] = [];
  const hashComments = HASH_COMMENTS.has(dialectId);
  const backslash = BACKSLASH_STRINGS.has(dialectId);

  let i = 0;
  let line = 1;
  let lineStart = 0;

  const advanceLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (sql[k] === '\n') {
        line++;
        lineStart = k + 1;
      }
    }
  };

  const push = (kind: TokenKind, start: number, end: number, value?: string) => {
    const text = sql.slice(start, end);
    tokens.push({ kind, text, value: value ?? text, start, end, line, column: start - lineStart + 1 });
    advanceLines(start, end);
  };

  /** Read a delimited run, where a doubled closer stands for one literal closer. */
  const delimited = (start: number, close: string, escapes: boolean): { end: number; inner: string } => {
    let j = start + 1;
    let inner = '';
    while (j < sql.length) {
      const ch = sql[j]!;
      if (escapes && ch === '\\' && j + 1 < sql.length) {
        inner += sql[j + 1];
        j += 2;
        continue;
      }
      if (ch === close) {
        if (sql[j + 1] === close) {
          inner += close;
          j += 2;
          continue;
        }
        return { end: j + 1, inner };
      }
      inner += ch;
      j++;
    }
    return { end: sql.length, inner };
  };

  while (i < sql.length) {
    const ch = sql[i]!;

    if (ch === '\n') {
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Comments are skipped, but the lines they cover still count.
    if ((ch === '-' && sql[i + 1] === '-') || (hashComments && ch === '#')) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      advanceLines(i, end);
      i = end;
      continue;
    }

    if (ch === "'") {
      const { end } = delimited(i, "'", backslash);
      push('string', i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === '`') {
      const { end, inner } = delimited(i, ch, false);
      push('quoted', i, end, inner);
      i = end;
      continue;
    }
    if (ch === '[') {
      // `text[]` and `integer[3]` are array types; anything else in brackets is a
      // SQL Server quoted name.
      const arraySuffix = /^\[\s*\d*\s*\]/.exec(sql.slice(i));
      if (arraySuffix) {
        push('punct', i, i + arraySuffix[0].length);
        i += arraySuffix[0].length;
        continue;
      }
      const { end, inner } = delimited(i, ']', false);
      push('quoted', i, end, inner);
      i = end;
      continue;
    }
    if (/[A-Za-z_\u0080-\uffff]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql[j]!)) j++;
      push('word', i, j);
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[0-9.]/.test(sql[j]!)) j++;
      push('number', i, j);
      i = j;
      continue;
    }
    push('punct', i, i + 1);
    i++;
  }

  return tokens;
}

const upper = (t: Token | undefined) => (t && t.kind === 'word' ? t.text.toUpperCase() : '');
const isPunct = (t: Token | undefined, p: string) => t?.kind === 'punct' && t.text === p;
const isName = (t: Token | undefined) => t?.kind === 'word' || t?.kind === 'quoted';

/* ------------------------------------------------------------------ parsing */

/** Words allowed between CREATE and TABLE. */
const TABLE_MODIFIERS = new Set([
  'OR',
  'REPLACE',
  'EXTERNAL',
  'TEMPORARY',
  'TEMP',
  'TRANSIENT',
  'VOLATILE',
  'GLOBAL',
  'LOCAL',
  'UNLOGGED',
  'MULTISET',
  'SET',
  'TRANSACTIONAL',
  'HYBRID',
  'DYNAMIC',
  'ICEBERG',
  'STREAMING',
  'LIVE',
  'FOREIGN',
  'SHARDED',
  'SNAPSHOT',
]);

/** Types whose parameters are written in angle brackets: `array<int>`, `struct<a:int>`. */
const ANGLE_TYPES = new Set(['ARRAY', 'MAP', 'STRUCT', 'UNIONTYPE']);

/** A table-level constraint rather than a column. */
const CONSTRAINT_STARTS = new Set([
  'CONSTRAINT',
  'PRIMARY',
  'FOREIGN',
  'CHECK',
  'EXCLUDE',
  'PERIOD',
  'FULLTEXT',
  'SPATIAL',
  'LIKE',
]);

/**
 * Words that end a column's type and begin its options.
 *
 * WITH and CHARACTER are handled separately: `timestamp with time zone` and
 * `character varying` are types, `WITH (…)` and `CHARACTER SET x` are options.
 */
const OPTION_STARTS = new Set([
  'NOT',
  'NULL',
  'DEFAULT',
  'COMMENT',
  'PRIMARY',
  'REFERENCES',
  'CONSTRAINT',
  'COLLATE',
  'ENCODE',
  'OPTIONS',
  'IDENTITY',
  'AUTO_INCREMENT',
  'AUTOINCREMENT',
  'GENERATED',
  'CHECK',
  'UNIQUE',
  'CHARSET',
  'MASKING',
  'ENABLE',
  'DISABLE',
  'ON',
  'AS',
  'STORED',
  'VIRTUAL',
  'SPARSE',
  'FILESTREAM',
  'ROWGUIDCOL',
  'CODEC',
  'TTL',
  'MATERIALIZED',
  'ALIAS',
  'EPHEMERAL',
  'TAG',
  'KEY',
  'DISTKEY',
  'SORTKEY',
  'INVISIBLE',
  'VISIBLE',
  'COLUMN_FORMAT',
  'STORAGE',
  'SRID',
  'POLICY',
  'USING',
  'DELIMITER',
]);

/** Split a token run into items at commas outside any brackets. */
function splitItems(tokens: Token[]): Token[][] {
  const items: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  const angles: number[] = [];

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.kind === 'punct') {
      if (t.text === '(') depth++;
      else if (t.text === ')') depth--;
      else if (t.text === '<' && ANGLE_TYPES.has(upper(tokens[k - 1]))) angles.push(depth);
      else if (t.text === '>' && angles.length > 0 && angles[angles.length - 1] === depth) angles.pop();
      else if (t.text === ',' && depth === 0 && angles.length === 0) {
        items.push(current);
        current = [];
        continue;
      }
    }
    current.push(t);
  }
  if (current.length > 0) items.push(current);
  return items;
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function matchingClose(tokens: Token[], open: number): number {
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    if (isPunct(tokens[k], '(')) depth++;
    else if (isPunct(tokens[k], ')')) {
      depth--;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** Rebuild source text for a token run, unquoting names and collapsing whitespace. */
function textOf(sql: string, tokens: Token[]): string {
  if (tokens.length === 0) return '';
  let out = '';
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (k > 0) {
      const gap = sql.slice(tokens[k - 1]!.end, t.start);
      if (/\s/.test(gap)) out += ' ';
    }
    out += t.kind === 'quoted' ? t.value : t.text;
  }
  return out.trim();
}

function isConstraint(item: Token[]): boolean {
  const first = upper(item[0]);
  if (CONSTRAINT_STARTS.has(first)) return true;
  // UNIQUE / KEY / INDEX start a constraint when an index name or a column list
  // follows — `KEY idx_name (name)`. A column called `key` is followed by its type.
  if (first === 'UNIQUE' || first === 'KEY' || first === 'INDEX') {
    const next = item[1];
    if (isPunct(next, '(')) return true;
    if (upper(next) === 'KEY' || upper(next) === 'INDEX') return true;
    // `KEY idx (name)` lists columns; `key varchar(10)` gives a length.
    if (isName(next) && isPunct(item[2], '(')) return item[3]?.kind !== 'number';
  }
  return false;
}

interface ReadColumn {
  column?: DdlColumn;
  error?: DdlError;
}

/** Read one column definition: name, type, then the options that matter for a diff. */
function readColumn(sql: string, item: Token[]): ReadColumn {
  const nameToken = item[0]!;
  if (!isName(nameToken)) {
    return {
      error: {
        line: nameToken.line,
        column: nameToken.column,
        message: `Could not read a column name at "${nameToken.text}".`,
      },
    };
  }

  // The type runs until the first option keyword outside brackets.
  let k = 1;
  let depth = 0;
  const typeTokens: Token[] = [];
  for (; k < item.length; k++) {
    const t = item[k]!;
    if (t.kind === 'punct' && t.text === '(') depth++;
    if (t.kind === 'punct' && t.text === ')') depth--;
    if (depth === 0 && t.kind === 'word' && typeTokens.length > 0) {
      const word = t.text.toUpperCase();
      if (word === 'WITH') {
        // `with time zone` and `with local time zone` are part of the type.
        const next = upper(item[k + 1]);
        if (next === 'TIME' || next === 'LOCAL') {
          typeTokens.push(t);
          continue;
        }
        break;
      }
      if (word === 'CHARACTER' && upper(item[k + 1]) === 'SET') break;
      if (OPTION_STARTS.has(word)) break;
    }
    if (depth === 0 && t.kind === 'string' && typeTokens.length > 0) break;
    if (depth === 0 && typeTokens.length === 0 && t.kind === 'word' && OPTION_STARTS.has(t.text.toUpperCase())) {
      // No type at all — SQLite allows it, and computed columns have none.
      break;
    }
    typeTokens.push(t);
  }

  const column: DdlColumn = {
    name: nameToken.value,
    type: textOf(sql, typeTokens),
    line: nameToken.line,
  };
  if (nameToken.kind === 'quoted') column.quoted = true;

  // Options: only the ones that describe the stored data.
  const rest = item.slice(k);
  for (let r = 0; r < rest.length; r++) {
    const word = upper(rest[r]);
    if (word === 'NOT' && upper(rest[r + 1]) === 'NULL') {
      column.notNull = true;
      r++;
    } else if (word === 'COLLATE' && rest[r + 1]) {
      column.collation = rest[r + 1]!.kind === 'quoted' ? rest[r + 1]!.value : rest[r + 1]!.text;
      r++;
    } else if (word === 'DEFAULT') {
      // The expression runs to the next option keyword outside brackets.
      const expr: Token[] = [];
      let d = 0;
      let e = r + 1;
      for (; e < rest.length; e++) {
        const t = rest[e]!;
        if (isPunct(t, '(')) d++;
        if (isPunct(t, ')')) d--;
        if (d === 0 && expr.length > 0 && t.kind === 'word' && OPTION_STARTS.has(t.text.toUpperCase())) break;
        expr.push(t);
      }
      column.defaultValue = textOf(sql, expr);
      r = e - 1;
    }
  }

  return { column };
}

/** `PARTITIONED BY (dt string, region string)`: columns declared outside the list. */
function readPartitionColumns(sql: string, tokens: Token[], from: number, taken: Set<string>): DdlColumn[] {
  const out: DdlColumn[] = [];
  for (let k = from; k < tokens.length; k++) {
    if (isPunct(tokens[k], ';')) break;
    if (upper(tokens[k]) !== 'PARTITIONED' || upper(tokens[k + 1]) !== 'BY' || !isPunct(tokens[k + 2], '(')) {
      continue;
    }
    const close = matchingClose(tokens, k + 2);
    if (close === -1) break;
    for (const item of splitItems(tokens.slice(k + 3, close))) {
      // `PARTITIONED BY (dt)` and `PARTITIONED BY (day(ts))` name existing columns or
      // transforms; only a name followed by a type declares a new one.
      if (item.length < 2 || !isName(item[0]) || isPunct(item[1], '(')) continue;
      const { column } = readColumn(sql, item);
      if (!column || column.type === '' || taken.has(column.name.toLowerCase())) continue;
      out.push({ ...column, partition: true });
    }
    break;
  }
  return out;
}

/**
 * A cheap check used to offer DDL extraction without parsing on every keystroke.
 * Deliberately loose: the parse itself is the real test.
 */
export function looksLikeDdl(text: string): boolean {
  return /\bcreate\s+(?:[a-z_]+\s+){0,4}table\b/i.test(text);
}

/** Where the next CREATE … TABLE starts, returning the index of the TABLE token. */
function findCreateTable(tokens: Token[], from: number): number {
  for (let k = from; k < tokens.length; k++) {
    if (upper(tokens[k]) !== 'CREATE') continue;
    for (let m = k + 1; m < Math.min(tokens.length, k + 7); m++) {
      const word = upper(tokens[m]);
      if (word === 'TABLE') return m;
      if (!TABLE_MODIFIERS.has(word)) break;
    }
  }
  return -1;
}

export async function parseDdl(sql: string, dialectId: string): Promise<DdlParseResult> {
  return parseDdlSync(sql, dialectId);
}

/**
 * Extract every column and its declared type from the first CREATE TABLE statement.
 *
 * Kept synchronous underneath: it is fast enough (a 450-column table reads in a
 * couple of milliseconds) that there is nothing to wait for. The async wrapper above
 * is the public shape because callers were written against an on-demand parser.
 */
export function parseDdlSync(sql: string, dialectId: string): DdlParseResult {
  if (sql.trim() === '') return { columns: [], errors: [] };

  const tokens = tokenize(sql, dialectId);
  const tableAt = findCreateTable(tokens, 0);
  if (tableAt === -1) {
    return {
      columns: [],
      errors: [{ line: 1, column: 1, message: 'Found no CREATE TABLE statement.' }],
    };
  }

  // IF NOT EXISTS, then a dotted name made of plain or quoted parts.
  let k = tableAt + 1;
  if (upper(tokens[k]) === 'IF' && upper(tokens[k + 1]) === 'NOT' && upper(tokens[k + 2]) === 'EXISTS') k += 3;
  const nameParts: string[] = [];
  while (isName(tokens[k])) {
    nameParts.push(tokens[k]!.value);
    if (isPunct(tokens[k + 1], '.')) k += 2;
    else {
      k++;
      break;
    }
  }
  const table = nameParts.length > 0 ? nameParts.join('.') : undefined;
  const createToken = tokens[tableAt]!;

  if (!isPunct(tokens[k], '(')) {
    const next = upper(tokens[k]);
    const why =
      next === 'AS'
        ? 'It is a CREATE TABLE … AS SELECT, which takes its columns from a query rather than declaring them.'
        : next === 'LIKE' || next === 'CLONE'
          ? `It copies another table (${next}), so it declares no columns of its own.`
          : 'Expected a column list in brackets after the table name.';
    return {
      table,
      columns: [],
      errors: [{ line: createToken.line, column: createToken.column, message: why }],
    };
  }

  const close = matchingClose(tokens, k);
  if (close === -1) {
    return {
      table,
      columns: [],
      errors: [
        {
          line: tokens[k]!.line,
          column: tokens[k]!.column,
          message: 'The column list is never closed — a ")" is missing.',
        },
      ],
    };
  }

  const columns: DdlColumn[] = [];
  const errors: DdlError[] = [];
  const taken = new Set<string>();

  for (const item of splitItems(tokens.slice(k + 1, close))) {
    if (item.length === 0) continue;
    if (isConstraint(item)) continue;
    const { column, error } = readColumn(sql, item);
    if (error) errors.push(error);
    if (column) {
      if (taken.has(column.name.toLowerCase())) {
        errors.push({
          line: column.line,
          column: 1,
          message: `"${column.name}" is declared twice.`,
        });
        continue;
      }
      taken.add(column.name.toLowerCase());
      columns.push(column);
    }
  }

  columns.push(...readPartitionColumns(sql, tokens, close + 1, taken));

  const notes: string[] = [];
  const another = findCreateTable(tokens, close + 1);
  if (another !== -1) {
    notes.push(
      'This holds more than one CREATE TABLE. Only the first was read — paste one table at a time.',
    );
  }

  return { table, columns, errors, ...(notes.length > 0 ? { notes } : {}) };
}

/** Render extracted columns as the `name<TAB>type` grid the generator already accepts. */
export function columnsToGrid(columns: DdlColumn[]): string {
  return columns.map((c) => `${c.name}\t${c.type}`).join('\n');
}

/* -------------------------------------------------------------------- types */

/**
 * Spellings that mean exactly the same type. Each maps to one canonical spelling so
 * `int` and `integer` compare equal, while `varchar` and `string` — which differ in
 * Hive, where one has a length and the other does not — stay different.
 */
const SYNONYMS: Record<string, string> = {
  integer: 'int',
  int4: 'int',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  'double precision': 'double',
  float8: 'double',
  float4: 'real',
  numeric: 'decimal',
  dec: 'decimal',
  'character varying': 'varchar',
  character: 'char',
  timestamptz: 'timestamp with time zone',
  'timestamp without time zone': 'timestamp',
  timetz: 'time with time zone',
  'time without time zone': 'time',
};

/**
 * A type reduced to what it means: lower-cased, spacing inside brackets removed, and
 * synonyms folded. `DECIMAL(18, 2)` and `numeric(18,2)` come out the same.
 */
export function canonicalType(type: string): string {
  let t = type.trim().toLowerCase().replace(/\s+/g, ' ');
  t = t.replace(/\s*([(),<>:])\s*/g, '$1');
  // Fold the base name, keeping any parameters: `integer` -> `int`, `numeric(10,2)` -> `decimal(10,2)`.
  const match = /^([a-z_ ]+?)(\(.*|<.*|\[.*)?$/.exec(t);
  if (match) {
    const base = match[1]!.trim();
    const params = match[2] ?? '';
    t = (SYNONYMS[base] ?? base) + params;
  }
  return t;
}

/* -------------------------------------------------------------------- diff */

export type DdlChangeKind = 'added' | 'removed' | 'retyped' | 'attributes' | 'moved' | 'unchanged';

export interface DdlAttributeChange {
  key: string;
  before?: string;
  after?: string;
}

export interface DdlChange {
  name: string;
  kind: DdlChangeKind;
  before?: string;
  after?: string;
  /** For `attributes` and `moved`: what else changed about the column. */
  attributes?: DdlAttributeChange[];
  /** Line each side declared the column on, for pointing at it. */
  beforeLine?: number;
  afterLine?: number;
}

/** The column properties other than type that change what is stored. */
function attributeChanges(a: DdlColumn, b: DdlColumn): DdlAttributeChange[] {
  const changes: DdlAttributeChange[] = [];
  const flag = (v: boolean | undefined) => (v ? 'yes' : 'no');
  const compare = (key: string, x: string | undefined, y: string | undefined, fold = false) => {
    const nx = fold ? x?.toLowerCase() : x;
    const ny = fold ? y?.toLowerCase() : y;
    if ((nx ?? '') !== (ny ?? '')) changes.push({ key, before: x, after: y });
  };
  compare('NOT NULL', flag(a.notNull), flag(b.notNull));
  compare('DEFAULT', a.defaultValue, b.defaultValue);
  compare('COLLATE', a.collation, b.collation, true);
  compare('partition column', flag(a.partition), flag(b.partition));
  return changes;
}

/**
 * The common columns that kept their relative order — the longest common subsequence.
 * Anything in both schemas but outside it has moved.
 */
function stableOrder(before: string[], after: string[]): Set<string> {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      kept.add(before[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return kept;
}

/**
 * Compare two schemas. The point is to narrow a migration check to what actually
 * changed rather than re-validating every column.
 *
 * Order is reported as its own kind of change. For Parquet it rarely matters, but a
 * CSV or ORC table in Athena and Hive reads columns by position, so two columns
 * swapped in the DDL silently swap their data.
 */
export function diffColumns(before: DdlColumn[], after: DdlColumn[]): DdlChange[] {
  const key = (c: DdlColumn) => c.name.toLowerCase();
  const beforeMap = new Map(before.map((c) => [key(c), c]));
  const afterMap = new Map(after.map((c) => [key(c), c]));

  const common = (list: DdlColumn[], other: Map<string, DdlColumn>) =>
    list.filter((c) => other.has(key(c))).map(key);
  const inOrder = stableOrder(common(before, afterMap), common(after, beforeMap));
  const position = (list: DdlColumn[], name: string) => list.findIndex((c) => key(c) === name) + 1;

  const changes: DdlChange[] = [];

  for (const column of before) {
    const match = afterMap.get(key(column));
    if (!match) {
      changes.push({ name: column.name, kind: 'removed', before: column.type, beforeLine: column.line });
      continue;
    }
    const base = {
      name: column.name,
      before: column.type,
      after: match.type,
      beforeLine: column.line,
      afterLine: match.line,
    };
    if (canonicalType(column.type) !== canonicalType(match.type)) {
      changes.push({ ...base, kind: 'retyped' });
      continue;
    }
    const attributes = attributeChanges(column, match);
    if (attributes.length > 0) {
      changes.push({ ...base, kind: 'attributes', attributes });
      continue;
    }
    if (!inOrder.has(key(column))) {
      changes.push({
        ...base,
        kind: 'moved',
        attributes: [
          {
            key: 'position',
            before: String(position(before, key(column))),
            after: String(position(after, key(column))),
          },
        ],
      });
      continue;
    }
    changes.push({ ...base, kind: 'unchanged' });
  }

  for (const column of after) {
    if (!beforeMap.has(key(column))) {
      changes.push({ name: column.name, kind: 'added', after: column.type, afterLine: column.line });
    }
  }

  return changes;
}
