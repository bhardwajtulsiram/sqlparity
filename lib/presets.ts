import { applyBindings, type GeneratedQuery, type Variable } from './generate';

/**
 * Built-in templates.
 *
 * These are the product's content as much as its features: a first-time visitor should
 * be able to pick one, paste a column list, and see useful SQL without reading docs.
 *
 * Each preset carries a template per dialect family. `default` covers everything that
 * has no specific entry — most of these are ordinary SQL and need no variation.
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
  templates: Record<string, string>;
  variables: Variable[];
  /** Present when the preset can also be emitted as a single combined query. */
  combine?: Record<string, CombineSpec>;
}

const constant = (name: string, value: string): Variable => ({ name, kind: 'constant', value });
const bulk = (name: string): Variable => ({ name, kind: 'bulk', value: '' });
const typed = (name: string): Variable => ({ name, kind: 'typed', value: '' });

const TABLES = [
  constant('table_a', 'input_db'),
  constant('table_b', 'output_db'),
  constant('key', 'customer_id'),
  { ...constant('key_out', ''), fallbackTo: 'key' },
];

export const PRESETS: Preset[] = [
  {
    id: 'column-comparison-sentinel',
    name: 'Column comparison (coalesce sentinel)',
    summary: 'Row-level differences for one column, using a per-type sentinel inside coalesce.',
    detail:
      'Uses a typed variable so each data type gets an appropriate sentinel. Note the known gap: if one side is NULL and the other holds the sentinel value itself, the rows compare equal and the difference is missed. The null-safe preset below has no such gap.',
    templates: {
      default: `SELECT
  a.{{key}},
  a.{{field}} AS input_value,
  b.{{field_out}} AS output_value
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}
WHERE coalesce(a.{{field}}, {{null_default}}) <> coalesce(b.{{field_out}}, {{null_default}})
LIMIT {{row_limit}}`,
    },
    variables: [
      ...TABLES,
      bulk('field'),
      bulk('field_out'),
      typed('null_default'),
      constant('row_limit', '10'),
    ],
  },
  {
    id: 'column-comparison-null-safe',
    name: 'Column comparison (null-safe)',
    summary: 'The same check with no sentinel — correct for every data type.',
    detail:
      'IS DISTINCT FROM treats NULL as a comparable value, so no sentinel is needed and no difference can hide behind one. MySQL has no such operator; the null-safe equality operator <=> is used there instead.',
    templates: {
      default: `SELECT
  a.{{key}},
  a.{{field}} AS input_value,
  b.{{field_out}} AS output_value
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}
WHERE a.{{field}} IS DISTINCT FROM b.{{field_out}}
LIMIT {{row_limit}}`,
      mysql: `SELECT
  a.{{key}},
  a.{{field}} AS input_value,
  b.{{field_out}} AS output_value
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}
WHERE NOT (a.{{field}} <=> b.{{field_out}})
LIMIT {{row_limit}}`,
      transactsql: `SELECT TOP ({{row_limit}})
  a.{{key}},
  a.{{field}} AS input_value,
  b.{{field_out}} AS output_value
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}
WHERE EXISTS (SELECT a.{{field}} EXCEPT SELECT b.{{field_out}})`,
    },
    variables: [...TABLES, bulk('field'), bulk('field_out'), constant('row_limit', '10')],
  },
  {
    id: 'mismatch-count',
    name: 'Mismatch count per column',
    summary: 'How many rows differ for each column, rather than which rows.',
    detail:
      'Combine this one into a single query to get a whole-table report in one run — far cheaper than one query per column on a billing-by-bytes-scanned engine.',
    templates: {
      default: `SELECT
  '{{field}}' AS field,
  count(*) AS mismatches
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}
WHERE a.{{field}} IS DISTINCT FROM b.{{field_out}}`,
      mysql: `SELECT
  '{{field}}' AS field,
  count(*) AS mismatches
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}
WHERE NOT (a.{{field}} <=> b.{{field_out}})`,
    },
    variables: [...TABLES, bulk('field'), bulk('field_out')],
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
    templates: {
      default: `  count_if(a.{{field}} IS DISTINCT FROM b.{{field_out}}) AS {{field}}`,
      mysql: `  sum(NOT (a.{{field}} <=> b.{{field_out}})) AS {{field}}`,
    },
    variables: [...TABLES, bulk('field'), bulk('field_out')],
    combine: {
      default: {
        header: 'SELECT\n',
        separator: ',\n',
        footer: '\nFROM {{table_a}} a\n  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}',
      },
    },
  },
  {
    id: 'null-rate',
    name: 'Null rate per column',
    summary: 'Whether nulls appeared or vanished during the migration.',
    templates: {
      default: `SELECT
  '{{field}}' AS field,
  count(*) AS total_rows,
  count_if(a.{{field}} IS NULL) AS input_nulls,
  count_if(b.{{field_out}} IS NULL) AS output_nulls
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}`,
      mysql: `SELECT
  '{{field}}' AS field,
  count(*) AS total_rows,
  sum(a.{{field}} IS NULL) AS input_nulls,
  sum(b.{{field_out}} IS NULL) AS output_nulls
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}`,
    },
    variables: [...TABLES, bulk('field'), bulk('field_out')],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'distinct-count',
    name: 'Distinct count per column',
    summary: 'Cardinality drift — did a column lose or gain distinct values.',
    templates: {
      default: `SELECT
  '{{field}}' AS field,
  count(DISTINCT a.{{field}}) AS input_distinct,
  count(DISTINCT b.{{field_out}}) AS output_distinct
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}`,
    },
    variables: [...TABLES, bulk('field'), bulk('field_out')],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'range-check',
    name: 'Min / max / sum per column',
    summary: 'Range and total checks for numeric and date columns.',
    templates: {
      default: `SELECT
  '{{field}}' AS field,
  min(a.{{field}}) AS input_min,
  max(a.{{field}}) AS input_max,
  min(b.{{field_out}}) AS output_min,
  max(b.{{field_out}}) AS output_max
FROM {{table_a}} a
  JOIN {{table_b}} b ON a.{{key}} = b.{{key_out}}`,
    },
    variables: [...TABLES, bulk('field'), bulk('field_out')],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'column-exists',
    name: 'Column existence check',
    summary: 'Which columns exist in one table but not the other.',
    detail:
      'Reads information_schema, so it tells you about schema drift without scanning any data.',
    templates: {
      default: `SELECT
  '{{field}}' AS field,
  count_if(table_name = '{{table_a}}') AS in_input,
  count_if(table_name = '{{table_b}}') AS in_output
FROM information_schema.columns
WHERE table_schema = '{{schema}}'
  AND table_name IN ('{{table_a}}', '{{table_b}}')
  AND column_name = '{{field}}'`,
      mysql: `SELECT
  '{{field}}' AS field,
  sum(table_name = '{{table_a}}') AS in_input,
  sum(table_name = '{{table_b}}') AS in_output
FROM information_schema.columns
WHERE table_schema = '{{schema}}'
  AND table_name IN ('{{table_a}}', '{{table_b}}')
  AND column_name = '{{field}}'`,
    },
    variables: [
      constant('schema', 'my_schema'),
      constant('table_a', 'input_db'),
      constant('table_b', 'output_db'),
      bulk('field'),
    ],
    combine: { default: { header: '', separator: '\nUNION ALL\n', footer: '' } },
  },
  {
    id: 'row-count',
    name: 'Row count per table',
    summary: 'Input and output totals, iterating over a list of tables.',
    detail: 'The bulk variable here is the table name rather than a column name.',
    templates: {
      default: `SELECT
  '{{table}}' AS table_name,
  (SELECT count(*) FROM {{schema_a}}.{{table}}) AS input_rows,
  (SELECT count(*) FROM {{schema_b}}.{{table}}) AS output_rows`,
    },
    variables: [
      constant('schema_a', 'input_schema'),
      constant('schema_b', 'output_schema'),
      bulk('table'),
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
