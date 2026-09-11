import type { Dialect } from './dialects';

/**
 * Typed variables resolve through this map.
 *
 * The map is per dialect because the same intent needs different syntax: Athena wants
 * `DATE '1900-01-01'`, MySQL wants a bare `'1900-01-01'`. Users get these as defaults
 * and can override any entry globally or per template.
 */
export type TypeMap = Record<string, string>;

/**
 * Reduce a declared type to the key used for lookup: lower-cased, with any length or
 * precision dropped. `DECIMAL(38,9)` and `varchar(50)` become `decimal` and `varchar`.
 */
export function normalizeType(declared: string): string {
  return declared
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Types that mean "text" across the dialects we support. */
const STRING_TYPES = ['varchar', 'char', 'string', 'text', 'nvarchar', 'nchar', 'character varying'];
const INT_TYPES = ['bigint', 'int', 'integer', 'smallint', 'tinyint', 'int64', 'number'];
const FLOAT_TYPES = ['double', 'float', 'real', 'double precision', 'float64'];
const DECIMAL_TYPES = ['decimal', 'numeric'];

function spread(keys: string[], value: string): TypeMap {
  return Object.fromEntries(keys.map((k) => [k, value]));
}

const BASE: TypeMap = {
  ...spread(STRING_TYPES, "'1'"),
  ...spread(INT_TYPES, '-1'),
  ...spread(FLOAT_TYPES, '-1.0'),
  ...spread(DECIMAL_TYPES, '-1'),
  boolean: 'false',
  bool: 'false',
};

const BY_DIALECT: Record<string, TypeMap> = {
  trino: {
    ...BASE,
    date: "DATE '1900-01-01'",
    timestamp: "TIMESTAMP '1900-01-01 00:00:00'",
    'timestamp with time zone': "TIMESTAMP '1900-01-01 00:00:00'",
    time: "TIME '00:00:00'",
    varbinary: "from_hex('00')",
  },
  mysql: {
    ...BASE,
    boolean: '0',
    bool: '0',
    date: "'1900-01-01'",
    datetime: "'1900-01-01 00:00:00'",
    timestamp: "'1900-01-01 00:00:00'",
    time: "'00:00:00'",
    year: '1900',
  },
  postgresql: {
    ...BASE,
    date: "DATE '1900-01-01'",
    timestamp: "TIMESTAMP '1900-01-01 00:00:00'",
    'timestamp without time zone': "TIMESTAMP '1900-01-01 00:00:00'",
    'timestamp with time zone': "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    time: "TIME '00:00:00'",
    uuid: "'00000000-0000-0000-0000-000000000000'::uuid",
  },
  bigquery: {
    ...BASE,
    date: "DATE '1900-01-01'",
    datetime: "DATETIME '1900-01-01 00:00:00'",
    timestamp: "TIMESTAMP '1900-01-01 00:00:00'",
    time: "TIME '00:00:00'",
    bytes: "b'0'",
  },
  transactsql: {
    ...BASE,
    boolean: '0',
    bit: '0',
    date: "'1900-01-01'",
    datetime: "'1900-01-01 00:00:00'",
    datetime2: "'1900-01-01 00:00:00'",
    time: "'00:00:00'",
  },
};

const FALLBACK: TypeMap = {
  ...BASE,
  date: "DATE '1900-01-01'",
  timestamp: "TIMESTAMP '1900-01-01 00:00:00'",
  time: "TIME '00:00:00'",
};

/** The shipped defaults for a dialect, before any user override. */
export function defaultTypeMap(dialect: Dialect): TypeMap {
  return { ...(BY_DIALECT[dialect.id] ?? FALLBACK) };
}

export interface ResolvedType {
  value?: string;
  /** Set when the type is absent from the map — generation must stop. */
  missing?: string;
}

/**
 * Look up a declared type.
 *
 * A missing type is reported rather than defaulted. Emitting a plausible-looking
 * sentinel for an unknown type would produce a query that runs cleanly and reports
 * the wrong answer, which is the worst outcome for a correctness tool.
 */
export function resolveType(declared: string, map: TypeMap): ResolvedType {
  const key = normalizeType(declared);
  if (key === '') return { missing: '(blank)' };
  const value = map[key];
  if (value === undefined) return { missing: key };
  return { value };
}

/** Merge global defaults with per-template overrides. */
export function effectiveTypeMap(
  dialect: Dialect,
  globalOverrides: TypeMap,
  templateOverrides: TypeMap,
): TypeMap {
  return { ...defaultTypeMap(dialect), ...globalOverrides, ...templateOverrides };
}

/** Which entries differ from the shipped defaults, for the "inherited vs overridden" display. */
export function overriddenKeys(dialect: Dialect, map: TypeMap): Set<string> {
  const defaults = defaultTypeMap(dialect);
  const changed = new Set<string>();
  for (const [key, value] of Object.entries(map)) {
    if (defaults[key] !== value) changed.add(key);
  }
  return changed;
}
