import { DIALECTS, type Dialect } from './dialects';
import { applyBindings, type GeneratedQuery, type Variable } from './generate';

/**
 * Built-in templates.
 *
 * These are the product's content as much as its features: a first-time visitor should
 * be able to pick one, paste a column list, and see useful SQL without reading docs.
 *
 * Each template is built per dialect from three pieces that genuinely differ between
 * engines — the null-safe comparison, how rows are capped, and whether a query needs a
 * FROM — rather than written once and hoped portable. The first versions were written
 * once, and `count_if`, `LIMIT` and `IS DISTINCT FROM` each failed on a different set
 * of engines, including PostgreSQL, the default.
 */

export interface CombineSpec {
  header: string;
  separator: string;
  footer: string;
}

export interface Preset {
  id: string;
  name: string;
  summary: string;
  /** Longer note shown when the preset is selected. */
  detail?: string;
  /** One template per dialect id, plus `default` for anything unlisted. */
  templates: Record<string, string>;
  variables: Variable[];
  /** Present when the preset can also be emitted as a single combined query. */
  combine?: Record<string, CombineSpec>;
  /** Dialects this preset cannot be written for, with the reason shown to the user. */
  unavailable?: Record<string, string>;
}

const constant = (name: string, value: string): Variable => ({ name, kind: 'constant', value });
/** A bulk variable whose values are column or table names. */
const names = (name: string): Variable => ({ name, kind: 'bulk', value: '', identifier: true });
const typed = (name: string): Variable => ({ name, kind: 'typed', value: '' });

const TABLES = [
  constant('table_a', 'input_db'),
  constant('table_b', 'output_db'),
  constant('key', 'customer_id'),
  { ...constant('key_out', ''), fallbackTo: 'key' },
];

/* ------------------------------------------------------------ dialect pieces */

/** "The two values differ, counting NULL as a value", in this dialect's words. */
function differs(d: Dialect, a: string, b: string): string {
  return d.nullSafeNotEqual(a, b);
}

/** A conditional count every engine here understands. `count_if` is not one of them. */
const countWhere = (condition: string) => `count(CASE WHEN ${condition} THEN 1 END)`;

/** Cap a SELECT at `limit` rows: SQL Server puts it up front, Oracle and Db2 at the end. */
function capped(d: Dialect, selectList: string, rest: string, limit: string): string {
  if (d.id === 'transactsql') return `SELECT TOP (${limit})\n${selectList}\n${rest}`;
  if (d.id === 'plsql' || d.id === 'db2' || d.id === 'sql') {
    return `SELECT\n${selectList}\n${rest}\nFETCH FIRST ${limit} ROWS ONLY`;
  }
  return `SELECT\n${selectList}\n${rest}\nLIMIT ${limit}`;
}

/** The FROM clause a SELECT with nothing to select from needs, where one is required. */
function noTable(d: Dialect): string {
  if (d.id === 'plsql') return '\nFROM dual';
  if (d.id === 'db2') return '\nFROM SYSIBM.SYSDUMMY1';
  return '';
}

const JOIN = `FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}`;

const COMPARED_COLUMNS = `  a.{{key}},
  a.{{field}} AS input_value,
  b.{{field_out}} AS output_value`;

/** Build a template for every dialect, keyed by id, with `default` as the ANSI version. */
function perDialect(build: (d: Dialect) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DIALECTS) out[d.id] = build(d);
  out.default = out.sql!;
  return out;
}

/* ------------------------------------------------------------------- presets */

export const PRESETS: Preset[] = [
  {
    id: 'column-comparison-sentinel',
    name: 'Column comparison (coalesce sentinel)',
    summary: 'Row-level differences for one column, using a per-type sentinel inside coalesce.',
    detail:
      'Uses a typed variable so each data type gets an appropriate sentinel. Note the known gap: if one side is NULL and the other holds the sentinel value itself, the rows compare equal and the difference is missed. The null-safe preset below has no such gap.',
    templates: perDialect((d) =>
      capped(
        d,
        COMPARED_COLUMNS,
        `${JOIN}\nWHERE coalesce(a.{{field}}, {{null_default}}) <> coalesce(b.{{field_out}}, {{null_default}})`,
        '{{row_limit}}',
      ),
    ),
    variables: [
      ...TABLES,
      names('field'),
      names('field_out'),
      typed('null_default'),
      constant('row_limit', '10'),
    ],
  },
  {
    id: 'column-comparison-null-safe',
    name: 'Column comparison (null-safe)',
    summary: 'The same check with no sentinel — correct for every data type.',
    detail:
      'Treats NULL as a comparable value, so no sentinel is needed and no difference can hide behind one. Written as IS DISTINCT FROM where the engine has it, as the <=> operator in MySQL, Hive and Spark, and spelled out in full for SQL Server, Oracle and ClickHouse.',
    templates: perDialect((d) =>
      capped(
        d,
        COMPARED_COLUMNS,
        `${JOIN}\nWHERE ${differs(d, 'a.{{field}}', 'b.{{field_out}}')}`,
        '{{row_limit}}',
      ),
    ),
    variables: [...TABLES, names('field'), names('field_out'), constant('row_limit', '10')],
  },
  {
    id: 'mismatch-count',
    name: 'Mismatch count per column',
    summary: 'How many rows differ for each column, rather than which rows.',
    detail:
      'Combine this one into a single query to get a whole-table report in one run — far cheaper than one query per column on a billing-by-bytes-scanned engine.',
    templates: perDialect(
      (d) => `SELECT
  '{{field}}' AS field,
  count(*) AS mismatches
${JOIN}
WHERE ${differs(d, 'a.{{field}}', 'b.{{field_out}}')}`,
    ),
    variables: [...TABLES, names('field'), names('field_out')],
    combine: {
      default: { header: '', separator: '\nUNION ALL\n', footer: '\nORDER BY mismatches DESC' },
    },
  },
  {
    id: 'single-scan-audit',
    name: 'Single-scan audit',
    summary: 'Every column checked in one pass over the tables.',
    detail:
      'Generates one fragment per column; combine them to get a single query that scans the tables once and returns a mismatch count per column. On Athena this is the cheapest way to check hundreds of columns.',
    templates: perDialect(
      (d) => `  ${countWhere(differs(d, 'a.{{field}}', 'b.{{field_out}}'))} AS {{field}}`,
    ),
    variables: [...TABLES, names('field'), names('field_out')],
    combine: {
      default: {
        header: 'SELECT\n',
        separator: ',\n',
        footer: `\n${JOIN}`,
      },
    },
  },
  {
    id: 'null-rate',
    name: 'Null rate per column',
    summary: 'Whether nulls appeared or vanished during the migration.',
    templates: perDialect(
      () => `SELECT
  '{{field}}' AS field,
  count(*) AS total_rows,
  ${countWhere('a.{{field}} IS NULL')} AS input_nulls,
  ${countWhere('b.{{field_out}} IS NULL')} AS output_nulls
${JOIN}`,
    ),
    variables: [...TABLES, names('field'), names('field_out')],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'distinct-count',
    name: 'Distinct count per column',
    summary: 'Cardinality drift — did a column lose or gain distinct values.',
    templates: perDialect(
      () => `SELECT
  '{{field}}' AS field,
  count(DISTINCT a.{{field}}) AS input_distinct,
  count(DISTINCT b.{{field_out}}) AS output_distinct
${JOIN}`,
    ),
    variables: [...TABLES, names('field'), names('field_out')],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'range-check',
    name: 'Min / max / sum per column',
    summary: 'Range and total checks for numeric and date columns.',
    templates: perDialect(
      () => `SELECT
  '{{field}}' AS field,
  min(a.{{field}}) AS input_min,
  max(a.{{field}}) AS input_max,
  min(b.{{field_out}}) AS output_min,
  max(b.{{field_out}}) AS output_max
${JOIN}`,
    ),
    variables: [...TABLES, names('field'), names('field_out')],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'column-exists',
    name: 'Column existence check',
    summary: 'Which columns exist in one table but not the other.',
    detail:
      'Reads the catalog, so it tells you about schema drift without scanning any data. Names are compared case-insensitively, since engines that fold unquoted names store them in upper or lower case.',
    templates: perDialect((d) => {
      const matches = (column: string, value: string) => `lower(${column}) = lower('${value}')`;
      if (d.id === 'sqlite') {
        const has = (table: string) =>
          `(SELECT count(*) FROM pragma_table_info('${table}') WHERE ${matches('name', '{{field}}')})`;
        return `SELECT
  '{{field}}' AS field,
  ${has('{{table_a}}')} AS in_input,
  ${has('{{table_b}}')} AS in_output`;
      }
      const catalog =
        d.id === 'plsql'
          ? { from: 'all_tab_columns', schema: 'owner', table: 'table_name', column: 'column_name' }
          : d.id === 'db2'
            ? { from: 'syscat.columns', schema: 'tabschema', table: 'tabname', column: 'colname' }
            : d.id === 'bigquery'
              ? { from: '{{schema}}.INFORMATION_SCHEMA.COLUMNS', schema: '', table: 'table_name', column: 'column_name' }
              : { from: 'information_schema.columns', schema: 'table_schema', table: 'table_name', column: 'column_name' };
      const where = [
        catalog.schema && matches(catalog.schema, '{{schema}}'),
        `lower(${catalog.table}) IN (lower('{{table_a}}'), lower('{{table_b}}'))`,
        matches(catalog.column, '{{field}}'),
      ].filter(Boolean);
      return `SELECT
  '{{field}}' AS field,
  ${countWhere(matches(catalog.table, '{{table_a}}'))} AS in_input,
  ${countWhere(matches(catalog.table, '{{table_b}}'))} AS in_output
FROM ${catalog.from}
WHERE ${where.join('\n  AND ')}`;
    }),
    variables: [
      constant('schema', 'my_schema'),
      constant('table_a', 'input_db'),
      constant('table_b', 'output_db'),
      names('field'),
    ],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
    unavailable: {
      hive: 'Hive has no information_schema, so column lists cannot be queried with SQL. Run DESCRIBE on both tables and compare them in Schema Diff instead.',
    },
  },
  {
    id: 'row-count',
    name: 'Row count per table',
    summary: 'Input and output totals, iterating over a list of tables.',
    detail: 'The bulk variable here is the table name rather than a column name.',
    templates: perDialect(
      (d) => `SELECT
  '{{table}}' AS table_name,
  (SELECT count(*) FROM {{schema_a}}.{{table}}) AS input_rows,
  (SELECT count(*) FROM {{schema_b}}.{{table}}) AS output_rows${noTable(d)}`,
    ),
    variables: [
      constant('schema_a', 'input_schema'),
      constant('schema_b', 'output_schema'),
      names('table'),
    ],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
];

function pick<T>(map: Record<string, T>, dialectId: string): T {
  return map[dialectId] ?? map.default!;
}

export function presetTemplate(preset: Preset, dialectId: string): string {
  return pick(preset.templates, dialectId);
}

export function presetCombine(preset: Preset, dialectId: string): CombineSpec | undefined {
  return preset.combine ? pick(preset.combine, dialectId) : undefined;
}

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Why a preset cannot be used with a dialect, when it cannot. */
export function presetUnavailable(preset: Preset, dialectId: string): string | undefined {
  return preset.unavailable?.[dialectId];
}

/**
 * Join generated statements into one query.
 *
 * The header and footer may themselves contain constant placeholders (the table names
 * in a single-scan audit, for instance), so they are bound after joining.
 */
export function combineQueries(
  queries: GeneratedQuery[],
  spec: CombineSpec,
  constantBindings: Record<string, string>,
): string {
  if (queries.length === 0) return '';
  const body = queries.map((q) => q.sql.trimEnd()).join(spec.separator);
  return applyBindings(`${spec.header}${body}${spec.footer}`, constantBindings);
}
