import type { DdlColumn } from './ddl';
import type { Dialect } from './dialects';
import { quoteIdentifier, quoteString } from './escape';
import { normalizeType } from './typemap';

/**
 * Test data that breaks migrations.
 *
 * Given a table's columns, produce rows whose values are the ones loaders get wrong:
 * apostrophes and backslashes, accents and right-to-left text, emoji, empty strings
 * next to NULLs, the longest value a VARCHAR(n) allows, the largest number a type
 * holds, a leap day, a timestamp inside a daylight-saving gap. Each value carries the
 * reason it is there, so a row that fails to load says which trap it fell into.
 *
 * Deterministic: the same columns, options and seed give the same rows, so a set can
 * be regenerated exactly and a failure reproduced.
 */

export type ValueKind = 'integer' | 'decimal' | 'float' | 'boolean' | 'date' | 'timestamp' | 'time' | 'text' | 'uuid' | 'json' | 'binary';

export interface ColumnSpec {
  name: string;
  /** The declared type, as written. */
  type: string;
  kind: ValueKind;
  nullable: boolean;
  /** For VARCHAR(n) and CHAR(n). */
  maxLength?: number;
  /** For DECIMAL(p, s). */
  precision?: number;
  scale?: number;
  /** Integer bounds for the declared size, as strings because BIGINT exceeds a JS number. */
  min?: string;
  max?: string;
  /** Looks like an identifier: generated unique. */
  isKey: boolean;
}

export interface Cell {
  /** The value as text, or null for SQL NULL. */
  value: string | null;
  kind: ValueKind;
  /** Why this value was chosen, when it is an edge case. */
  edge?: string;
}

export interface TestDataOptions {
  rows: number;
  /** Put the edge cases first. Off gives plausible values only. */
  edgeCases: boolean;
  /** Share of nullable cells that are NULL in ordinary rows, 0 to 1. */
  nullRate: number;
  seed: number;
}

export const DEFAULT_TEST_DATA: TestDataOptions = { rows: 50, edgeCases: true, nullRate: 0.1, seed: 42 };

export const MAX_ROWS = 10_000;

/* ------------------------------------------------------------ type reading */

const INT_BOUNDS: Record<string, [string, string]> = {
  tinyint: ['0', '255'],
  smallint: ['-32768', '32767'],
  int2: ['-32768', '32767'],
  mediumint: ['-8388608', '8388607'],
  int: ['-2147483648', '2147483647'],
  integer: ['-2147483648', '2147483647'],
  int4: ['-2147483648', '2147483647'],
  serial: ['1', '2147483647'],
  bigint: ['-9223372036854775808', '9223372036854775807'],
  int8: ['-9223372036854775808', '9223372036854775807'],
  bigserial: ['1', '9223372036854775807'],
  long: ['-9223372036854775808', '9223372036854775807'],
  byteint: ['-128', '127'],
  int64: ['-9223372036854775808', '9223372036854775807'],
};

const KEY_NAME = /(^id$|_id$|^id_|key$|^code$|_code$|_no$|_number$|^uuid$|_uuid$)/i;

function firstNumbers(type: string): number[] {
  const inside = /\(([^)]*)\)/.exec(type)?.[1];
  if (!inside) return [];
  return inside
    .split(',')
    .map((n) => Number.parseInt(n.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/** Read a declared type into what the generator needs to know about it. */
export function columnSpec(column: Pick<DdlColumn, 'name' | 'type' | 'notNull'>): ColumnSpec {
  const t = normalizeType(column.type);
  const nums = firstNumbers(column.type);
  const base = {
    name: column.name,
    type: column.type,
    nullable: !column.notNull,
    isKey: KEY_NAME.test(column.name),
  };

  if (t in INT_BOUNDS || /^u?int\d*$|^(?:tiny|small|medium|big)int\b|^serial|^bigserial/.test(t)) {
    const [min, max] = INT_BOUNDS[t] ?? INT_BOUNDS[t.replace(/^u/, '')] ?? INT_BOUNDS.int!;
    const unsigned = /unsigned/i.test(column.type) || /^u/.test(t);
    return { ...base, kind: 'integer', min: unsigned ? '0' : min, max };
  }
  if (/^(decimal|numeric|number|dec|money|smallmoney|bignumeric)$/.test(t)) {
    const precision = nums[0] ?? (t === 'money' ? 19 : 18);
    const scale = nums[1] ?? (t === 'money' || t === 'smallmoney' ? 4 : t === 'number' && nums.length === 0 ? 4 : 0);
    if (t === 'number' && nums.length === 1) return { ...base, kind: scale === 0 ? 'integer' : 'decimal', precision, scale, min: `-${'9'.repeat(Math.min(precision, 18))}`, max: '9'.repeat(Math.min(precision, 18)) };
    return { ...base, kind: 'decimal', precision, scale };
  }
  if (/^(float|float4|float8|real|double|double precision|float64|binary_float|binary_double)$/.test(t)) {
    return { ...base, kind: 'float' };
  }
  if (/^(bool|boolean|bit)$/.test(t)) return { ...base, kind: 'boolean' };
  if (t === 'date') return { ...base, kind: 'date' };
  if (/^(timestamp|datetime|datetime2|smalldatetime|timestamptz|timestamp with time zone|timestamp without time zone|timestamp_ntz|timestamp_ltz|timestamp_tz|datetimeoffset)/.test(t)) {
    return { ...base, kind: 'timestamp' };
  }
  if (/^(time|timetz|time with time zone|time without time zone)$/.test(t)) return { ...base, kind: 'time' };
  if (/^(uuid|uniqueidentifier)$/.test(t)) return { ...base, kind: 'uuid' };
  if (/^(json|jsonb|variant|object|super)$/.test(t)) return { ...base, kind: 'json' };
  if (/^(binary|varbinary|bytea|blob|longblob|mediumblob|tinyblob|bytes|raw|image)$/.test(t)) return { ...base, kind: 'binary' };
  if (/^(array|map|struct|row|list)$/.test(t)) return { ...base, kind: 'json' };
  const length = /char|string|text|varchar/.test(t) ? nums[0] : undefined;
  return { ...base, kind: 'text', ...(length ? { maxLength: length } : {}) };
}

/* ------------------------------------------------------------- randomness */

/** mulberry32: small, fast and the same in every browser. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

/* -------------------------------------------------------------- edge cases */

interface Edge {
  value: string | null;
  edge: string;
}

function maxDecimal(precision: number, scale: number): string {
  const whole = Math.max(precision - scale, 0);
  return `${whole > 0 ? '9'.repeat(Math.min(whole, 30)) : '0'}${scale > 0 ? '.' + '9'.repeat(Math.min(scale, 30)) : ''}`;
}

function textEdges(spec: ColumnSpec): Edge[] {
  const max = spec.maxLength;
  const longest = (max ?? 255);
  const edges: Edge[] = [
    { value: "O'Brien", edge: 'apostrophe' },
    { value: 'Say "hello"', edge: 'double quotes' },
    { value: 'C:\\temp\\new', edge: 'backslashes' },
    { value: 'Zoë Müller-Ñúñez', edge: 'accented letters' },
    { value: '東京都 渋谷区', edge: 'Japanese text' },
    { value: 'مرحبا بالعالم', edge: 'right-to-left text' },
    { value: 'Thanks 🙂👍', edge: 'emoji (4-byte UTF-8)' },
    { value: '  padded  ', edge: 'leading and trailing spaces' },
    { value: '', edge: 'empty string, not NULL' },
    { value: 'NULL', edge: 'the word NULL as text' },
    { value: 'line one\nline two', edge: 'newline inside the value' },
    { value: 'tab\tseparated', edge: 'tab inside the value' },
    { value: 'a, b; c', edge: 'comma and semicolon' },
    { value: '007', edge: 'leading zeros' },
    { value: 'x'.repeat(longest), edge: max ? `longest value ${spec.type} allows` : 'long value (255 characters)' },
  ];
  // A value that only fits when counted in characters, not bytes: catches a column
  // migrated from character to byte semantics.
  if (max && max >= 2) edges.push({ value: 'é'.repeat(max), edge: `${max} characters, ${max * 2} bytes` });
  return edges
    .map((e) => (max !== undefined && e.value !== null && [...e.value].length > max ? { ...e, value: [...e.value].slice(0, max).join('') } : e))
    .filter((e, i, list) => list.findIndex((o) => o.value === e.value) === i);
}

function edgesFor(spec: ColumnSpec): Edge[] {
  switch (spec.kind) {
    case 'integer':
      return [
        { value: '0', edge: 'zero' },
        { value: spec.min === '0' ? '1' : '-1', edge: spec.min === '0' ? 'one' : 'negative' },
        { value: spec.max ?? '2147483647', edge: `largest ${normalizeType(spec.type)}` },
        { value: spec.min ?? '-2147483648', edge: `smallest ${normalizeType(spec.type)}` },
      ];
    case 'decimal': {
      const p = spec.precision ?? 18;
      const s = spec.scale ?? 0;
      const step = s > 0 ? `0.${'0'.repeat(s - 1)}1` : '1';
      return [
        { value: '0', edge: 'zero' },
        { value: maxDecimal(p, s), edge: `largest decimal(${p},${s})` },
        { value: `-${maxDecimal(p, s)}`, edge: `smallest decimal(${p},${s})` },
        { value: step, edge: s > 0 ? 'smallest step' : 'one' },
        { value: `-${step}`, edge: 'negative smallest step' },
      ];
    }
    case 'float':
      return [
        { value: '0', edge: 'zero' },
        { value: '0.1', edge: 'not exact in binary' },
        { value: '-273.15', edge: 'negative' },
        { value: '1e-10', edge: 'very small' },
        { value: '1e15', edge: 'very large' },
      ];
    case 'boolean':
      return [
        { value: 'true', edge: 'true' },
        { value: 'false', edge: 'false' },
      ];
    case 'date':
      return [
        { value: '2024-02-29', edge: 'leap day' },
        { value: '1970-01-01', edge: 'Unix epoch' },
        { value: '1999-12-31', edge: 'end of a century' },
        { value: '2038-01-19', edge: '32-bit time limit' },
        { value: '1900-01-01', edge: 'early date' },
        { value: '9999-12-31', edge: 'latest date most engines store' },
      ];
    case 'timestamp':
      return [
        { value: '2024-02-29 23:59:59', edge: 'leap day, last second' },
        { value: '1970-01-01 00:00:00', edge: 'Unix epoch' },
        { value: '2026-03-29 02:30:00', edge: 'inside the European DST gap' },
        { value: '2026-11-01 01:30:00', edge: 'repeated hour in US DST change' },
        { value: '2038-01-19 03:14:08', edge: 'one second past the 32-bit limit' },
        { value: '2026-12-31 23:59:59.999', edge: 'milliseconds at year end' },
      ];
    case 'time':
      return [
        { value: '00:00:00', edge: 'midnight' },
        { value: '23:59:59', edge: 'last second of the day' },
        { value: '12:00:00', edge: 'noon' },
      ];
    case 'uuid':
      return [
        { value: '00000000-0000-0000-0000-000000000000', edge: 'nil UUID' },
        { value: 'ffffffff-ffff-ffff-ffff-ffffffffffff', edge: 'max UUID' },
      ];
    case 'json':
      return [
        { value: '{}', edge: 'empty object' },
        { value: '[]', edge: 'empty array' },
        { value: '{"name":"O\'Brien","tags":["a","b"]}', edge: 'apostrophe inside JSON' },
        { value: '{"nested":{"deep":{"value":null}}}', edge: 'nested, with a JSON null' },
      ];
    case 'binary':
      return [
        { value: '00', edge: 'single zero byte' },
        { value: 'deadbeef', edge: 'arbitrary bytes' },
      ];
    case 'text':
      return textEdges(spec);
  }
}

/* --------------------------------------------------------- plausible values */

const FIRST = ['Ada', 'Grace', 'Alan', 'Katherine', 'Edsger', 'Barbara', 'Donald', 'Margaret', 'José', 'Aiko', 'Chidi', 'Ingrid', 'Rahul', 'Fatima', 'Lars', 'Mei'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Dijkstra', 'Liskov', 'Knuth', 'Hamilton', 'García', 'Tanaka', 'Okafor', 'Larsen', 'Sharma', 'Haddad', 'Berg', 'Chen'];
const CITIES = ['London', 'Lagos', 'Mumbai', 'São Paulo', 'Toronto', 'Berlin', 'Tokyo', 'Sydney', 'Nairobi', 'Madrid'];
const COUNTRIES = ['GB', 'NG', 'IN', 'BR', 'CA', 'DE', 'JP', 'AU', 'KE', 'ES', 'US', 'FR'];
const STATUSES = ['active', 'pending', 'shipped', 'cancelled', 'refunded'];
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function plausible(spec: ColumnSpec, row: number, rand: () => number): string {
  const name = spec.name.toLowerCase();
  switch (spec.kind) {
    case 'integer': {
      if (spec.isKey) return String(1000 + row);
      const max = Math.min(Number(spec.max ?? 1000), 100_000);
      const min = Math.max(Number(spec.min ?? 0), 0);
      return String(Math.floor(min + rand() * Math.max(1, Math.min(max - min, 999))));
    }
    case 'decimal': {
      const s = spec.scale ?? 2;
      const whole = Math.max((spec.precision ?? 10) - s, 1);
      const cap = Math.min(10 ** Math.min(whole, 6) - 1, 99_999);
      return (rand() * cap).toFixed(s);
    }
    case 'float':
      return String(Math.round(rand() * 1_000_000) / 100);
    case 'boolean':
      return rand() < 0.5 ? 'true' : 'false';
    case 'date': {
      const d = new Date(Date.UTC(2020, 0, 1) + Math.floor(rand() * 2400) * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
    case 'timestamp': {
      const d = new Date(Date.UTC(2020, 0, 1) + Math.floor(rand() * 2400 * 86_400) * 1000);
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }
    case 'time':
      return `${pad(Math.floor(rand() * 24), 2)}:${pad(Math.floor(rand() * 60), 2)}:${pad(Math.floor(rand() * 60), 2)}`;
    case 'uuid': {
      const hex = () => Math.floor(rand() * 16).toString(16);
      const part = (n: number) => Array.from({ length: n }, hex).join('');
      return `${part(8)}-${part(4)}-4${part(3)}-a${part(3)}-${part(12)}`;
    }
    case 'json':
      return JSON.stringify({ id: row + 1, tag: pick(rand, WORDS) });
    case 'binary':
      return Array.from({ length: 4 }, () => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('');
    case 'text': {
      let value: string;
      if (spec.isKey) value = `K${pad(row + 1, 5)}`;
      else if (/email/.test(name)) value = `${pick(rand, FIRST).toLowerCase().normalize('NFD').replace(/[^\x20-\x7e]/g, '')}.${row + 1}@example.com`;
      else if (/(^|_)(first_?name|given)/.test(name)) value = pick(rand, FIRST);
      else if (/(^|_)(last_?name|surname|family)/.test(name)) value = pick(rand, LAST);
      else if (/name/.test(name)) value = `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
      else if (/city/.test(name)) value = pick(rand, CITIES);
      else if (/country/.test(name)) value = pick(rand, COUNTRIES);
      else if (/status|state/.test(name)) value = pick(rand, STATUSES);
      else if (/phone/.test(name)) value = `+44 20 7946 ${pad(Math.floor(rand() * 10000), 4)}`;
      else value = `${pick(rand, WORDS)} ${row + 1}`;
      return spec.maxLength ? [...value].slice(0, spec.maxLength).join('') : value;
    }
  }
}

/* ---------------------------------------------------------------- generate */

/**
 * The rows. With edge cases on, the first rows walk each column through its own list
 * of traps — row i takes the column's i-th edge case — followed by one row with every
 * nullable column NULL; the rest are plausible values, NULL at the chosen rate.
 *
 * Key columns stay unique throughout, because a duplicate key would stop the load
 * before any value could be tested. Text keys get near-duplicates instead ('K00001'
 * against 'k00001'), which is the edge a case-insensitive target collation trips on.
 */
export function generateRows(specs: ColumnSpec[], options: TestDataOptions): Cell[][] {
  const rand = random(options.seed);
  const total = Math.max(0, Math.min(MAX_ROWS, Math.floor(options.rows)));
  const edgeLists = specs.map((s) => (options.edgeCases && !s.isKey ? edgesFor(s) : []));
  const edgeRows = options.edgeCases ? Math.max(0, ...edgeLists.map((l) => l.length)) : 0;
  const rows: Cell[][] = [];

  for (let r = 0; r < total; r++) {
    const allNullRow = options.edgeCases && r === edgeRows;
    rows.push(
      specs.map((spec, c): Cell => {
        if (spec.isKey) {
          if (options.edgeCases && spec.kind === 'text' && r === 1) {
            return { value: 'k00001', kind: spec.kind, edge: 'differs from row 1 only by case' };
          }
          return { value: plausible(spec, r, rand), kind: spec.kind };
        }
        const edges = edgeLists[c]!;
        if (r < edges.length) {
          const e = edges[r]!;
          return { value: e.value, kind: spec.kind, edge: e.edge };
        }
        if (allNullRow && spec.nullable) return { value: null, kind: spec.kind, edge: 'NULL in every nullable column' };
        if (spec.nullable && rand() < options.nullRate) return { value: null, kind: spec.kind };
        return { value: plausible(spec, r, rand), kind: spec.kind };
      }),
    );
  }
  return rows;
}

/* ------------------------------------------------------------------ output */

/** Dialects where a date or timestamp must be a typed literal, not a plain string. */
const TYPED_DATES = new Set(['plsql', 'trino', 'bigquery', 'spark', 'hive', 'db2', 'sql']);
/** Dialects with no TRUE/FALSE literal in an INSERT. */
const NUMERIC_BOOLEANS = new Set(['transactsql', 'plsql', 'sqlite']);
/** Dialects with no multi-row VALUES. */
const ONE_ROW_INSERTS = new Set(['plsql']);

function sqlLiteral(cell: Cell, dialect: Dialect): string {
  if (cell.value === null) return 'NULL';
  const v = cell.value;
  switch (cell.kind) {
    case 'integer':
    case 'decimal':
    case 'float':
      return v;
    case 'boolean':
      return NUMERIC_BOOLEANS.has(dialect.id) ? (v === 'true' ? '1' : '0') : v.toUpperCase();
    case 'date':
      return TYPED_DATES.has(dialect.id) ? `DATE ${quoteString(v, dialect)}` : quoteString(v, dialect);
    case 'timestamp':
      return TYPED_DATES.has(dialect.id) ? `TIMESTAMP ${quoteString(v, dialect)}` : quoteString(v, dialect);
    case 'binary':
      return dialect.id === 'postgresql' || dialect.id === 'redshift'
        ? `'\\x${v}'`
        : dialect.id === 'transactsql'
          ? `0x${v}`
          : `X'${v}'`;
    default: {
      // SQL Server reads a plain literal in the code page: without N, anything outside
      // it becomes '?' — the exact silent corruption this data exists to catch.
      const quoted = quoteString(v, dialect);
      return dialect.id === 'transactsql' && /[^\x00-\x7f]/.test(v) ? `N${quoted}` : quoted;
    }
  }
}

export function toInsertSql(table: string, specs: ColumnSpec[], rows: Cell[][], dialect: Dialect, batch = 100): string {
  if (rows.length === 0) return '';
  const target = table
    .split('.')
    .map((p) => quoteIdentifier(p, dialect))
    .join('.');
  const columns = specs.map((s) => quoteIdentifier(s.name, dialect)).join(', ');
  const tuple = (row: Cell[]) => `(${row.map((c) => sqlLiteral(c, dialect)).join(', ')})`;

  if (ONE_ROW_INSERTS.has(dialect.id)) {
    return rows.map((row) => `INSERT INTO ${target} (${columns}) VALUES ${tuple(row)};`).join('\n');
  }
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    statements.push(`INSERT INTO ${target} (${columns}) VALUES\n${chunk.map((r) => `  ${tuple(r)}`).join(',\n')};`);
  }
  return statements.join('\n\n');
}

/** RFC 4180: quote a field holding a comma, quote, CR or LF, and double inner quotes. NULL is an empty field. */
export function toCsv(specs: ColumnSpec[], rows: Cell[][]): string {
  const field = (v: string | null) => (v === null ? '' : /[",\r\n]|^\s|\s$/.test(v) || v === '' ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = [specs.map((s) => field(s.name)).join(',')];
  for (const row of rows) lines.push(row.map((c) => field(c.value)).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** One JSON object per line, with numbers and booleans as JSON values rather than text. */
export function toJsonLines(specs: ColumnSpec[], rows: Cell[][]): string {
  return (
    rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(
            row.map((c, i) => {
              const v = c.value;
              const typed =
                v === null
                  ? null
                  : c.kind === 'boolean'
                    ? v === 'true'
                    : (c.kind === 'integer' || c.kind === 'decimal' || c.kind === 'float') && Number.isSafeInteger(Number(v)) && !/\./.test(v)
                      ? Number(v)
                      : c.kind === 'float'
                        ? Number(v)
                        : v;
              return [specs[i]!.name, typed];
            }),
          ),
        ),
      )
      .join('\n') + '\n'
  );
}
