/**
 * The parts of the scratchpad that are decidable without an engine.
 *
 * Naming a table, choosing a reader, and rendering a cell are all pure functions of
 * their input, so they live here and are tested directly. What is left in the
 * component is the part that genuinely needs DuckDB, which keeps the untestable
 * surface small.
 */

export type FileKind = 'csv' | 'parquet' | 'json' | 'unsupported';

/** What DuckDB should use to read a file, decided by extension. */
export function fileKind(filename: string): FileKind {
  const name = filename.toLowerCase();
  // .csv.gz and friends are read by the same function; DuckDB handles the decompression.
  const stem = name.replace(/\.(gz|zst|bz2)$/, '');
  if (stem.endsWith('.csv') || stem.endsWith('.tsv') || stem.endsWith('.txt')) return 'csv';
  if (stem.endsWith('.parquet') || stem.endsWith('.pq')) return 'parquet';
  if (stem.endsWith('.json') || stem.endsWith('.ndjson') || stem.endsWith('.jsonl')) return 'json';
  return 'unsupported';
}

/**
 * Turn a filename into a table name that can be typed unquoted.
 *
 * The point is that someone can write `SELECT * FROM orders` straight after dropping
 * orders.csv, without discovering that their file was called `2026 Orders (final).csv`
 * and now needs quoting. Collisions get a numeric suffix rather than silently
 * replacing the table already loaded.
 */
export function tableNameFor(filename: string, taken: ReadonlySet<string> = new Set()): string {
  // Compression suffix first: stripping the format extension from orders.csv.gz would
  // only remove .gz and leave orders.csv, which becomes the table orders_csv.
  const base = filename.replace(/\.(gz|zst|bz2)$/i, '').replace(/\.[^.]+$/, '');

  let name = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // A leading digit is not a valid identifier start in any dialect here.
  if (name === '' || /^[0-9]/.test(name)) name = `t_${name}`;
  name = name.replace(/_+$/, '');

  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The reader function DuckDB needs for a given kind. */
export function readerFor(kind: FileKind): string {
  switch (kind) {
    case 'csv':
      return 'read_csv_auto';
    case 'parquet':
      return 'read_parquet';
    case 'json':
      return 'read_json_auto';
    default:
      throw new Error(`No reader for ${kind}`);
  }
}

/**
 * The statement that materialises a dropped file as a table.
 *
 * The registered name is single-quoted, so an apostrophe in a filename would end the
 * literal early. Rare, but it produces a syntax error the user cannot explain, and the
 * fix is one replace.
 */
export function loadSql(
  table: string,
  registeredName: string,
  kind: FileKind,
  /** Extra reader options, such as `sample_size=-1`. */
  options: string[] = [],
): string {
  const path = registeredName.replaceAll("'", "''");
  const args = [`'${path}'`, ...options].join(', ');
  return `CREATE OR REPLACE TABLE "${quoteName(table)}" AS SELECT * FROM ${readerFor(kind)}(${args})`;
}

/** A name for use inside double quotes. */
export function quoteName(name: string): string {
  return name.replaceAll('"', '""');
}

/* ------------------------------------------------------ reading a CSV well */

/**
 * Why a CSV failed to load, in terms of the row that broke it.
 *
 * DuckDB guesses each column's type from a sample of rows. A value further down that
 * does not fit — `N/A` in a column of numbers — fails the whole load with a long
 * message about sniffer options. This picks out the row, the value and the column.
 */
export function describeCsvFailure(message: string): string | null {
  const line = /CSV Error on Line:\s*(\d+)/i.exec(message)?.[1];
  const value = /Could not convert string "([^"]*)"/i.exec(message)?.[1];
  const column = /converting column "([^"]+)"/i.exec(message)?.[1];
  const type = /to '([A-Z0-9_]+)'/i.exec(message)?.[1];
  if (!line || value === undefined || !column) return null;
  return `line ${Number(line).toLocaleString()} has "${value}" in ${column}, which does not fit the ${type ?? 'type'} guessed from the rows above it`;
}

/** Plain words for a date format, when day and month could be read either way round. */
export function ambiguousDateFormat(format: string | null | undefined): string | null {
  if (!format) return null;
  const month = format.indexOf('%m');
  const day = format.indexOf('%d');
  const year = format.indexOf('%Y');
  if (month === -1 || day === -1 || (year !== -1 && year < month && year < day)) return null;
  return month < day ? 'month first (03/04/2026 is 4 March)' : 'day first (03/04/2026 is 3 April)';
}

/** The other order, for the statement that reloads a file with it. */
export function swappedDateFormat(format: string): string {
  return format.replace('%m', '\u0000').replace('%d', '%m').replace('\u0000', '%d');
}

/** How the values in a text column look, counted over a sample. */
export interface TextColumnShape {
  column: string;
  nonNull: number;
  /** `1,5` and `1.234,56`. */
  decimalComma: number;
  /** `1,234.56`. */
  thousands: number;
  /** `99.50`. */
  plain: number;
}

/** The SQL that counts those shapes for each text column in one pass over a sample. */
export function textShapeSql(table: string, columns: string[], sampleRows = 10000): string {
  const parts = columns.flatMap((name, i) => {
    const c = `"${quoteName(name)}"`;
    return [
      `count(${c}) AS n${i}`,
      `count(*) FILTER (WHERE regexp_full_match(${c}, '-?[0-9]{1,3}([.][0-9]{3})*,[0-9]+|-?[0-9]+,[0-9]+')) AS dc${i}`,
      `count(*) FILTER (WHERE regexp_full_match(${c}, '-?[0-9]{1,3}(,[0-9]{3})+([.][0-9]+)?')) AS th${i}`,
      `count(*) FILTER (WHERE regexp_full_match(${c}, '-?[0-9]+([.][0-9]+)?')) AS pl${i}`,
    ];
  });
  return `SELECT ${parts.join(', ')} FROM (SELECT * FROM "${quoteName(table)}" LIMIT ${sampleRows})`;
}

/** Read `textShapeSql`'s single row back into one shape per column. */
export function readTextShapes(columns: string[], row: unknown[]): TextColumnShape[] {
  return columns.map((column, i) => ({
    column,
    nonNull: Number(row[i * 4] ?? 0),
    decimalComma: Number(row[i * 4 + 1] ?? 0),
    thousands: Number(row[i * 4 + 2] ?? 0),
    plain: Number(row[i * 4 + 3] ?? 0),
  }));
}

/** Columns every one of whose values is a number written with a decimal comma. */
export function decimalCommaColumns(shapes: TextColumnShape[]): string[] {
  return shapes.filter((s) => s.nonNull > 0 && s.decimalComma === s.nonNull).map((s) => s.column);
}

/** Columns of numbers written with thousands separators, which were read as text. */
export function thousandsColumns(shapes: TextColumnShape[]): string[] {
  return shapes
    .filter((s) => s.thousands > 0 && s.thousands + s.plain >= s.nonNull * 0.9)
    .map((s) => s.column);
}

/* -------------------------------------------------- showing values faithfully */

/**
 * Column types whose values are shown as DuckDB's own text rather than converted in
 * JavaScript.
 *
 * Arrow hands these over in a form that loses something on the way: timestamps
 * arrive as milliseconds and drop their microseconds, TIME as a raw microsecond
 * count, INTERVAL garbled, and lists and structs as JSON with every decimal unscaled
 * and every date an epoch number. DuckDB's own cast to text gets all of them right.
 */
const SHOWN_AS_TEXT = /^(?:TIMESTAMP|TIME\b|TIMETZ|INTERVAL|STRUCT|MAP|UNION|BIT$)|\[\d*\]$/i;

export function textDisplayColumns(described: [name: string, type: string][]): string[] {
  const names = described.map(([name]) => name);
  // SELECT * REPLACE needs every name to be unique; with duplicates, leave it alone.
  if (new Set(names).size !== names.length) return [];
  return described.filter(([, type]) => SHOWN_AS_TEXT.test(type.trim())).map(([name]) => name);
}

/** Statements that only read, and so can be described and wrapped for display. */
export function isReadOnlyQuery(sql: string): boolean {
  return /^\s*(?:\(\s*)*(?:SELECT|WITH|FROM|VALUES|TABLE|PIVOT|UNPIVOT)\b/i.test(sql);
}

/** The query with the given columns cast to text, everything else untouched. */
export function textDisplaySql(sql: string, columns: string[]): string {
  const casts = columns.map((c) => `CAST("${quoteName(c)}" AS VARCHAR) AS "${quoteName(c)}"`);
  return `SELECT * REPLACE (${casts.join(', ')}) FROM (${stripTrailingSemicolon(sql)}) AS sqlparity_display`;
}

/**
 * The loaded table the query reads, so its columns can be suggested bare.
 *
 * With one table loaded that is obvious. With several, the editor would otherwise
 * only suggest a column after `table.`, which nobody types when writing `WHERE`.
 */
export function referencedTable(sql: string, tables: readonly LoadedTable[]): string | undefined {
  const loaded = new Map(tables.map((t) => [t.table.toLowerCase(), t.table]));
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+"?([A-Za-z_][\w]*)"?/gi)) {
    const found = loaded.get(m[1]!.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

/**
 * Render one result cell for display.
 *
 * NULL is shown as a distinct marker rather than an empty cell, because in a tool
 * about data correctness the difference between null and empty string is the whole
 * question. BigInt gets its own branch since JSON.stringify throws on it.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

/** True when a cell holds no value, so the view can style it differently from text. */
export function isNullCell(value: unknown): boolean {
  return value === null || value === undefined;
}

export interface QueryShape {
  columns: string[];
  rows: unknown[][];
  /** Rows the engine returned, before any display cap. */
  totalRows: number;
  truncated: boolean;
}

/**
 * Cap what gets rendered.
 *
 * A SELECT * over a million-row Parquet file will answer instantly and then lock the
 * tab building a million DOM rows. The count reported stays the real one.
 */
export const MAX_DISPLAY_ROWS = 500;

export function shapeResult(
  columns: string[],
  rows: unknown[][],
  total: number = rows.length,
  cap: number = MAX_DISPLAY_ROWS,
): QueryShape {
  const shown = rows.length > cap ? rows.slice(0, cap) : rows;
  return {
    columns,
    rows: shown,
    // The caller may already have capped `rows`, so trust the total it was given.
    totalRows: Math.max(total, rows.length),
    truncated: Math.max(total, rows.length) > shown.length,
  };
}

/**
 * Catch a CSV that the sniffer failed to split.
 *
 * DuckDB does not error on a ragged CSV — it falls back to reading each line as one
 * wide column, so the table loads "successfully" with a single field named
 * `account,zip,segment,total`. Nothing about that looks like a failure until you try
 * to query a column and find it does not exist, which reads as the tool being broken
 * rather than the file being malformed. Detecting it costs one check.
 */
export function csvSniffWarning(kind: FileKind, columns: string[]): string | null {
  if (kind !== 'csv' || columns.length !== 1) return null;

  const only = columns[0] ?? '';
  const found = [
    [',', 'comma'],
    [';', 'semicolon'],
    ['	', 'tab'],
    ['|', 'pipe'],
  ].find(([character]) => only.includes(character));
  if (!found) return null;

  return `Every field landed in one column, so the ${found[1]} separator could not be worked out. That usually means an unquoted separator inside a value, or a row with more fields than the header. Quote those values and drop the file again.`;
}

/**
 * Catch a CSV whose header was never recognised.
 *
 * When rows disagree about how many fields they hold, DuckDB stops treating the first
 * line as a header and falls back to column0, column1 and so on — and quietly drops
 * the lines that did not fit. The table loads, the row count looks plausible, and data
 * is missing. Generic column names are the cheap tell.
 */
export function csvHeaderWarning(kind: FileKind, columns: string[]): string | null {
  if (kind !== 'csv' || columns.length < 2) return null;
  if (!columns.every((name, i) => name === `column${i}`)) return null;

  return 'No header row was recognised, so the columns came back as column0, column1 and so on. That happens when rows hold different numbers of fields — usually an unquoted separator inside a value — and rows that did not fit may have been skipped. Check the row count against the file before trusting this.';
}

/**
 * The result as tab-separated text, for the clipboard.
 *
 * Tabs rather than commas because the destination is almost always a spreadsheet or a
 * chat message, and a comma inside a value would silently split a column there. A tab
 * or newline inside a value would do the same, so those are shown as escapes instead
 * of being pasted as real whitespace.
 */
export function toTsv(columns: string[], rows: unknown[][]): string {
  // NULL is \N, as in PostgreSQL's COPY text format, whose escaping this follows.
  // Writing it as the word NULL made it indistinguishable from a string 'NULL' —
  // exactly the kind of value a migration check needs to tell apart.
  const cell = (value: unknown) =>
    isNullCell(value)
      ? '\\N'
      : formatCell(value).replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n');
  return [columns.join('\t'), ...rows.map((row) => row.map(cell).join('\t'))].join('\n');
}

/**
 * Strip a trailing semicolon so a statement can be wrapped in COPY (...) TO.
 *
 * People end statements with a semicolon out of habit, and `COPY (SELECT 1;) TO`
 * is a syntax error that would look like the export being broken.
 */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, '').trimEnd();
}

/**
 * The result as CSV, used when DuckDB cannot write the file itself.
 *
 * Two conventions worth being deliberate about. CSV has no NULL, so an unquoted
 * empty field means null and a quoted empty one means the empty string — the same
 * distinction PostgreSQL's own CSV export makes, and one that matters more here than
 * most places. And a value holding a comma, a quote or a line break is quoted with
 * its quotes doubled, or it silently becomes extra columns in whatever opens it.
 *
 * Lines end LF, matching what DuckDB's own writer produces on the primary path, so
 * the two routes cannot hand back files that differ only in line endings.
 */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const cell = (value: unknown): string => {
    if (isNullCell(value)) return '';
    const text = formatCell(value);
    // A quoted empty field is how an empty string stays distinguishable from null.
    if (text === '') return '""';
    // A comma, a quote or a line break inside a value has to be quoted, or it turns
    // into extra columns or extra rows in whatever opens the file.
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  const lines = [columns.map((name) => cell(name)), ...rows.map((row) => row.map(cell))];
  return lines.map((line) => line.join(',')).join('\n');
}

/* ------------------------------------------------------------- completion */

export interface LoadedTable {
  table: string;
  columns: string[];
}

/**
 * The tables and columns to offer as completions.
 *
 * Built from what is actually loaded rather than from the SQL text, so a column only
 * ever appears in the list if querying it would work. Suggesting a name that does not
 * exist is worse than suggesting nothing.
 */
export function completionSchema(tables: readonly LoadedTable[]): Record<string, string[]> {
  const schema: Record<string, string[]> = {};
  for (const { table, columns } of tables) schema[table] = [...columns];
  return schema;
}

/**
 * The table whose columns can be completed without a prefix.
 *
 * Only when there is exactly one. With several loaded, a bare column name belongs to
 * no particular table, and picking one would put the wrong table's columns in reach.
 */
export function defaultCompletionTable(tables: readonly LoadedTable[]): string | undefined {
  return tables.length === 1 ? tables[0].table : undefined;
}

/* --------------------------------------------------- arrow value conversion */

/**
 * Arrow hands back three types in a shape that is wrong to show directly.
 *
 * A DECIMAL arrives as its unscaled integer — 1.005 comes through as 1005 — so
 * printing the value verbatim puts a number on screen that is a thousand times too
 * big. DATE and TIMESTAMP arrive as epoch milliseconds, which render as a
 * thirteen-digit integer rather than a date. Both are exactly the kind of confident
 * wrong answer this project refuses elsewhere, so the conversion happens where the
 * column's type is still known, on the way out of Arrow.
 *
 * The ids are from the Arrow format itself rather than class names, which a
 * production build is free to mangle.
 */
const ARROW_DECIMAL = 7;
const ARROW_DATE = 8;
const ARROW_TIMESTAMP = 10;

export interface ArrowFieldType {
  typeId?: number;
  scale?: number;
}

/** Put the decimal point back into an unscaled integer. */
export function scaleDecimal(digits: string, scale: number): string {
  if (scale <= 0) return digits;
  const negative = digits.startsWith('-');
  const body = (negative ? digits.slice(1) : digits).padStart(scale + 1, '0');
  const whole = body.slice(0, body.length - scale);
  const fraction = body.slice(body.length - scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Epoch milliseconds as a date, with no time part. */
export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch milliseconds as a timestamp, dropping a zero millisecond part. */
export function formatTimestamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  const body = iso.endsWith('.000Z') ? iso.slice(0, 19) : iso.slice(0, -1);
  return body.replace('T', ' ');
}

/** A converter for one column, or null when the values need no adjusting. */
export function arrowConverter(type: ArrowFieldType | undefined): ((value: unknown) => unknown) | null {
  if (!type) return null;

  if (type.typeId === ARROW_DECIMAL && typeof type.scale === 'number') {
    const scale = type.scale;
    return (value) => (value === null || value === undefined ? value : scaleDecimal(String(value), scale));
  }
  if (type.typeId === ARROW_DATE) {
    return (value) => (typeof value === 'number' ? formatDate(value) : value);
  }
  if (type.typeId === ARROW_TIMESTAMP) {
    return (value) => (typeof value === 'number' ? formatTimestamp(value) : value);
  }
  return null;
}

/** Human-readable byte size for the loading and file-list copy. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
