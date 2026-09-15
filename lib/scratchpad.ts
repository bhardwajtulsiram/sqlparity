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
export function loadSql(table: string, registeredName: string, kind: FileKind): string {
  const path = registeredName.replaceAll("'", "''");
  return `CREATE OR REPLACE TABLE "${table}" AS SELECT * FROM ${readerFor(kind)}('${path}')`;
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
