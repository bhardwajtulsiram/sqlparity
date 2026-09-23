import { describe, it, expect } from 'vitest';
import { DIALECTS } from '../lib/dialects';
import { PRESETS, presetTemplate, presetUnavailable } from '../lib/presets';

/**
 * Every preset in every dialect, checked for the constructs that engine does not have.
 *
 * The lists come from each engine's documentation. They are the failures the first
 * versions of these templates actually had: `count_if` on PostgreSQL, `LIMIT` on SQL
 * Server and Oracle, `IS DISTINCT FROM` on SQL Server and Oracle.
 */
const NO_COUNT_IF = DIALECTS.map((d) => d.id);
const NO_LIMIT = ['transactsql', 'plsql'];
const NO_DISTINCT_FROM = ['transactsql', 'plsql', 'mysql', 'mariadb', 'hive', 'spark', 'clickhouse'];

const all = PRESETS.flatMap((preset) =>
  DIALECTS.filter((d) => !presetUnavailable(preset, d.id)).map((d) => ({
    preset,
    dialect: d,
    sql: presetTemplate(preset, d.id),
  })),
);

describe('presets run on the engine they are written for', () => {
  it('never uses count_if, which most engines lack', () => {
    for (const { preset, dialect, sql } of all) {
      if (NO_COUNT_IF.includes(dialect.id)) {
        expect(sql, `${preset.id} / ${dialect.id}`).not.toMatch(/count_if/i);
      }
    }
  });

  it('caps rows the way each engine does', () => {
    for (const { preset, dialect, sql } of all) {
      if (NO_LIMIT.includes(dialect.id)) {
        expect(sql, `${preset.id} / ${dialect.id}`).not.toMatch(/\bLIMIT\b/);
      }
    }
    const tsql = presetTemplate(PRESETS[0]!, 'transactsql');
    expect(tsql).toMatch(/^SELECT TOP \(\{\{row_limit\}\}\)/);
    expect(presetTemplate(PRESETS[0]!, 'plsql')).toMatch(/FETCH FIRST \{\{row_limit\}\} ROWS ONLY$/);
    expect(presetTemplate(PRESETS[0]!, 'trino')).toMatch(/LIMIT \{\{row_limit\}\}$/);
  });

  it('only uses IS DISTINCT FROM where it exists', () => {
    for (const { preset, dialect, sql } of all) {
      if (NO_DISTINCT_FROM.includes(dialect.id)) {
        expect(sql, `${preset.id} / ${dialect.id}`).not.toMatch(/IS DISTINCT FROM/i);
      }
    }
  });

  it('uses each engine’s own null-safe comparison', () => {
    const nullSafe = PRESETS.find((p) => p.id === 'column-comparison-null-safe')!;
    expect(presetTemplate(nullSafe, 'postgresql')).toContain('a.{{field}} IS DISTINCT FROM b.{{field_out}}');
    expect(presetTemplate(nullSafe, 'mysql')).toContain('NOT (a.{{field}} <=> b.{{field_out}})');
    expect(presetTemplate(nullSafe, 'hive')).toContain('NOT (a.{{field}} <=> b.{{field_out}})');
    expect(presetTemplate(nullSafe, 'transactsql')).toContain(
      '(a.{{field}} <> b.{{field_out}} OR (a.{{field}} IS NULL AND b.{{field_out}} IS NOT NULL)',
    );
  });

  it('gives a FROM-less query the dummy table Oracle and Db2 require', () => {
    const rowCount = PRESETS.find((p) => p.id === 'row-count')!;
    expect(presetTemplate(rowCount, 'plsql')).toMatch(/FROM dual$/);
    expect(presetTemplate(rowCount, 'db2')).toMatch(/FROM SYSIBM\.SYSDUMMY1$/);
    expect(presetTemplate(rowCount, 'postgresql')).not.toMatch(/dual/);
  });

  it('reads the right catalog for column existence', () => {
    const exists = PRESETS.find((p) => p.id === 'column-exists')!;
    expect(presetTemplate(exists, 'postgresql')).toContain('FROM information_schema.columns');
    expect(presetTemplate(exists, 'plsql')).toContain('FROM all_tab_columns');
    expect(presetTemplate(exists, 'bigquery')).toContain('{{schema}}.INFORMATION_SCHEMA.COLUMNS');
    expect(presetTemplate(exists, 'sqlite')).toContain('pragma_table_info');
    expect(presetUnavailable(exists, 'hive')).toContain('DESCRIBE');
  });

  it('marks the variables that hold names, so they can be quoted', () => {
    for (const preset of PRESETS) {
      for (const v of preset.variables.filter((x) => x.kind === 'bulk')) {
        expect(v.identifier, `${preset.id}.${v.name}`).toBe(true);
      }
    }
  });
});
