import type { Dialect } from './dialects';

/**
 * Typed variables resolve through this map.
 *
 * The map is per dialect because the same intent needs different syntax: Athena wants
 * `DATE '1900-01-01'`, MySQL wants a bare `'1900-01-01'`. Users get these as defaults
 * and can override any entry globally or per template.
 */
export type TypeMap = Record<string, string>;

/** Types built from other types. Only the outer name decides the sentinel. */
const COMPOUND = ['array', 'map', 'struct', 'row', 'uniontype', 'tuple', 'nested', 'object'];

/**
 * Reduce a declared type to the key used for lookup: lower-cased, with any length,
 * precision and modifiers dropped. `DECIMAL(38,9)` becomes `decimal`,
 * `int(11) unsigned` becomes `int`, `timestamp(6) with time zone` becomes
 * `timestamp with time zone`, and `array<struct<a:int>>` becomes `array`.
 */
export function normalizeType(declared: string): string {
  let t = declared.trim().toLowerCase();

  // ClickHouse wraps the real type: Nullable(String), LowCardinality(Nullable(String)).
  for (;;) {
    const wrapped = /^(?:nullable|lowcardinality)\s*\((.*)\)$/.exec(t);
    if (!wrapped) break;
    t = wrapped[1]!.trim();
  }

  const compound = /^([a-z_]+)\s*[<(]/.exec(t);
  if (compound && COMPOUND.includes(compound[1]!)) return compound[1]!;
  // PostgreSQL arrays: text[], integer[3].
  if (/\[\s*\d*\s*\]\s*$/.test(t)) return 'array';

  return t
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:unsigned|signed|zerofill)\b/g, ' ')
    .replace(/\bfor bit data\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Types that mean "text" across the dialects we support.
 *
 * The sentinel is `'~'` rather than something like `'1'`: it has to be a value the
 * column is very unlikely to hold, because a NULL on one side and the sentinel itself
 * on the other compare equal and hide the difference.
 */
const STRING_TYPES = [
  'varchar',
  'char',
  'string',
  'text',
  'nvarchar',
  'nchar',
  'character varying',
  'character',
  'national character varying',
  'national char varying',
  'national character',
  'bpchar',
  'citext',
  'varchar2',
  'nvarchar2',
  'tinytext',
  'mediumtext',
  'longtext',
  'enum',
  'set',
  'fixedstring',
];
const INT_TYPES = [
  'bigint',
  'int',
  'integer',
  'smallint',
  'tinyint',
  'mediumint',
  'int2',
  'int4',
  'int8',
  'int16',
  'int32',
  'int64',
  'int128',
  'int256',
  'byteint',
  'serial',
  'bigserial',
  'smallserial',
  'serial4',
  'serial8',
  'number',
  'hugeint',
  'long',
];
const FLOAT_TYPES = [
  'double',
  'float',
  'real',
  'double precision',
  'float4',
  'float8',
  'float32',
  'float64',
  'binary_float',
  'binary_double',
];
const DECIMAL_TYPES = [
  'decimal',
  'numeric',
  'dec',
  'money',
  'smallmoney',
  'bignumeric',
  'bigdecimal',
  'decimal32',
  'decimal64',
  'decimal128',
  'decimal256',
];

function spread(keys: string[], value: string): TypeMap {
  return Object.fromEntries(keys.map((k) => [k, value]));
}

const BASE: TypeMap = {
  ...spread(STRING_TYPES, "'~'"),
  ...spread(INT_TYPES, '-1'),
  ...spread(FLOAT_TYPES, '-1.0'),
  ...spread(DECIMAL_TYPES, '-1'),
  boolean: 'false',
  bool: 'false',
};

const DATE = "DATE '1900-01-01'";
const TIMESTAMP = "TIMESTAMP '1900-01-01 00:00:00'";
const TIME = "TIME '00:00:00'";

/** The typed-literal family: Trino, PostgreSQL, Snowflake, BigQuery, Spark and most others. */
const TYPED_LITERALS: TypeMap = {
  ...BASE,
  date: DATE,
  timestamp: TIMESTAMP,
  datetime: TIMESTAMP,
  time: TIME,
};

const BY_DIALECT: Record<string, TypeMap> = {
  trino: {
    ...TYPED_LITERALS,
    'timestamp with time zone': "TIMESTAMP '1900-01-01 00:00:00 UTC'",
    'time with time zone': "TIME '00:00:00+00:00'",
    varbinary: "X'00'",
    binary: "X'00'",
    uuid: "UUID '00000000-0000-0000-0000-000000000000'",
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
    bit: "b'0'",
    binary: "X'00'",
    varbinary: "X'00'",
    blob: "X'00'",
    tinyblob: "X'00'",
    mediumblob: "X'00'",
    longblob: "X'00'",
  },
  postgresql: {
    ...TYPED_LITERALS,
    'timestamp without time zone': TIMESTAMP,
    'timestamp with time zone': "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    timestamptz: "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    'time without time zone': TIME,
    'time with time zone': "TIMETZ '00:00:00+00'",
    timetz: "TIMETZ '00:00:00+00'",
    interval: "INTERVAL '-1 microsecond'",
    uuid: "'00000000-0000-0000-0000-000000000000'::uuid",
    bytea: "'\\x00'::bytea",
    jsonb: `'"~"'::jsonb`,
    inet: "'0.0.0.0/32'::inet",
    cidr: "'0.0.0.0/32'::cidr",
  },
  redshift: {
    ...TYPED_LITERALS,
    'timestamp without time zone': TIMESTAMP,
    'timestamp with time zone': "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    timestamptz: "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    'time without time zone': TIME,
    timetz: "TIMETZ '00:00:00+00'",
  },
  snowflake: {
    ...TYPED_LITERALS,
    timestamp_ntz: "'1900-01-01 00:00:00'::TIMESTAMP_NTZ",
    timestamp_ltz: "'1900-01-01 00:00:00'::TIMESTAMP_LTZ",
    timestamp_tz: "'1900-01-01 00:00:00 +00:00'::TIMESTAMP_TZ",
    binary: "TO_BINARY('00')",
    varbinary: "TO_BINARY('00')",
  },
  bigquery: {
    ...TYPED_LITERALS,
    datetime: "DATETIME '1900-01-01 00:00:00'",
    bytes: "b'0'",
  },
  spark: {
    ...TYPED_LITERALS,
    timestamp_ntz: "TIMESTAMP_NTZ '1900-01-01 00:00:00'",
    timestamp_ltz: TIMESTAMP,
    binary: "X'00'",
  },
  hive: {
    ...TYPED_LITERALS,
    binary: "unhex('00')",
  },
  transactsql: {
    ...BASE,
    boolean: '0',
    bit: '0',
    date: "'1900-01-01'",
    datetime: "'1900-01-01 00:00:00'",
    datetime2: "'1900-01-01 00:00:00'",
    smalldatetime: "'1900-01-01 00:00:00'",
    datetimeoffset: "'1900-01-01 00:00:00 +00:00'",
    time: "'00:00:00'",
    uniqueidentifier: "'00000000-0000-0000-0000-000000000000'",
    binary: '0x00',
    varbinary: '0x00',
  },
  plsql: {
    ...BASE,
    date: DATE,
    timestamp: TIMESTAMP,
    'timestamp with time zone': "TIMESTAMP '1900-01-01 00:00:00 +00:00'",
    'timestamp with local time zone': TIMESTAMP,
    raw: "HEXTORAW('00')",
  },
  clickhouse: {
    ...spread(STRING_TYPES, "'~'"),
    ...spread(['int8', 'int16', 'int32', 'int64', 'int128', 'int256'], '-1'),
    // Unsigned integers cannot hold -1, and ClickHouse finds no common type for a
    // UInt64 and a negative literal. The largest value of each width is the sentinel.
    uint8: '255',
    uint16: '65535',
    uint32: '4294967295',
    uint64: '18446744073709551615',
    uint128: 'toUInt128(-1)',
    uint256: 'toUInt256(-1)',
    ...spread(['float32', 'float64'], '-1.0'),
    ...spread(DECIMAL_TYPES, '-1'),
    bool: 'false',
    boolean: 'false',
    // ClickHouse's Date starts at 1970; Date32 reaches back to 1900.
    date: "toDate('1970-01-01')",
    date32: "toDate32('1900-01-01')",
    datetime: "toDateTime('1970-01-01 00:00:00')",
    datetime64: "toDateTime64('1900-01-01 00:00:00', 3)",
    uuid: "toUUID('00000000-0000-0000-0000-000000000000')",
  },
  duckdb: {
    ...TYPED_LITERALS,
    'timestamp with time zone': "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    timestamptz: "TIMESTAMPTZ '1900-01-01 00:00:00+00'",
    uuid: "UUID '00000000-0000-0000-0000-000000000000'",
    blob: "'\\x00'::BLOB",
    ubigint: '18446744073709551615',
    uinteger: '4294967295',
    usmallint: '65535',
    utinyint: '255',
  },
};

const FALLBACK: TypeMap = TYPED_LITERALS;

/**
 * Types that have no sensible sentinel at all: collections, documents and binary
 * blobs cannot be meaningfully coalesced to a stand-in value and compared. They are
 * named separately so the message can point at the check that does work for them.
 */
const NO_SENTINEL = new Set([
  ...COMPOUND,
  'json',
  'jsonb',
  'variant',
  'super',
  'geography',
  'geometry',
  'clob',
  'nclob',
  'blob',
  'ntext',
  'image',
  'xml',
  'hstore',
]);

/** The shipped defaults for a dialect, before any user override. */
export function defaultTypeMap(dialect: Dialect): TypeMap {
  return { ...(BY_DIALECT[dialect.id] ?? FALLBACK) };
}

export interface ResolvedType {
  value?: string;
  /** Set when the type is absent from the map — this column cannot be generated. */
  missing?: string;
  /** True when no sentinel could ever be right for the type, as opposed to one not being configured. */
  unsentinelable?: boolean;
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
  if (value === undefined) return { missing: key, ...(NO_SENTINEL.has(key) ? { unsentinelable: true } : {}) };
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
