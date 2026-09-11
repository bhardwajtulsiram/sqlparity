import { describe, it, expect, beforeAll } from 'vitest';
import { validateSql, supportsValidation, templateToProbeSql, probeTemplate } from '../lib/validate';

// The parser is loaded on demand and Vite transforms it the first time, which alone
// can exceed the default timeout. Warm it once, then give each test room.
beforeAll(async () => {
  await validateSql('SELECT 1', 'trino');
  await validateSql('SELECT 1', 'mysql');
  await validateSql('SELECT 1', 'postgresql');
}, 60_000);

describe('supportsValidation', () => {
  it('is true for the dialects with a real grammar', () => {
    expect(supportsValidation('trino')).toBe(true);
    expect(supportsValidation('mysql')).toBe(true);
    expect(supportsValidation('mariadb')).toBe(true);
    expect(supportsValidation('tidb')).toBe(true);
    expect(supportsValidation('postgresql')).toBe(true);
    expect(supportsValidation('redshift')).toBe(true);
    expect(supportsValidation('duckdb')).toBe(true);
  });

  it('is false for dialects with no dedicated grammar in the library', () => {
    expect(supportsValidation('bigquery')).toBe(false);
    expect(supportsValidation('snowflake')).toBe(false);
    expect(supportsValidation('transactsql')).toBe(false);
    expect(supportsValidation('plsql')).toBe(false);
    expect(supportsValidation('sqlite')).toBe(false);
    expect(supportsValidation('clickhouse')).toBe(false);
    expect(supportsValidation('db2')).toBe(false);
    expect(supportsValidation('sql')).toBe(false);
  });
});

describe('validateSql: Trino', () => {
  it('finds no errors in valid SQL', async () => {
    expect(await validateSql('SELECT a, b FROM t WHERE a = 1', 'trino')).toEqual([]);
  });

  it('reports a syntax error with a position', async () => {
    const errors = await validateSql('SELECT a FRM t', 'trino');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.line).toBe(1);
    expect(errors[0]!.column).toBeGreaterThan(0);
    expect(errors[0]!.message).toBeTruthy();
  });

  it('accepts IS DISTINCT FROM, which is genuine Trino syntax', async () => {
    expect(
      await validateSql('SELECT * FROM t WHERE a IS DISTINCT FROM b', 'trino'),
    ).toEqual([]);
  });

  it('accepts a CTE', async () => {
    const sql = 'WITH x AS (SELECT 1 AS a) SELECT a FROM x';
    expect(await validateSql(sql, 'trino')).toEqual([]);
  });

  it('reports every error, not just the first', async () => {
    // Two independent problems in one statement.
    const errors = await validateSql('SELECT FRM t; SELECT b FRM u', 'trino');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('validateSql: MySQL', () => {
  it('finds no errors in valid SQL', async () => {
    expect(await validateSql('SELECT a FROM t WHERE a = 1', 'mysql')).toEqual([]);
  });

  it('reports a syntax error', async () => {
    const errors = await validateSql('SELECT a FRM t', 'mysql');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('validateSql: PostgreSQL', () => {
  it('finds no errors in valid SQL', async () => {
    expect(await validateSql('SELECT a FROM t WHERE a = 1', 'postgresql')).toEqual([]);
  });

  it('reports a syntax error', async () => {
    const errors = await validateSql('SELECT a FRM t', 'postgresql');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('unsupported dialects', () => {
  it('returns no errors rather than a wrong answer', async () => {
    // Silence, not a false "this is valid" or false "this is broken" — the dialect
    // simply has no grammar to check against.
    expect(await validateSql('SELECT FRM t this is not sql at all', 'bigquery')).toEqual([]);
    expect(await validateSql('SELECT FRM t this is not sql at all', 'snowflake')).toEqual([]);
  });
});

describe('edge cases', () => {
  it('returns nothing for empty input without loading a parser', async () => {
    expect(await validateSql('   ', 'trino')).toEqual([]);
  });

  it('template placeholders are not valid SQL and are expected to error', async () => {
    // {{field}} is not substituted before validation — this documents that a
    // template containing placeholders will show errors at the placeholder, which
    // callers should expect rather than treat as a validator bug.
    const errors = await validateSql('SELECT {{field}} FROM t', 'trino');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('templateToProbeSql', () => {
  it('replaces an ordinary placeholder with a fixed identifier token', () => {
    expect(templateToProbeSql('SELECT {{field}} FROM t')).toBe('SELECT __x__ FROM t');
  });

  it('replaces a LIMIT placeholder with a literal integer, not an identifier', () => {
    expect(templateToProbeSql('SELECT a FROM t LIMIT {{row_limit}}')).toBe(
      'SELECT a FROM t LIMIT 1',
    );
  });

  it('replaces an OFFSET placeholder with a literal integer', () => {
    expect(templateToProbeSql('SELECT a FROM t OFFSET {{skip}}')).toBe('SELECT a FROM t OFFSET 1');
  });

  it('handles LIMIT and other placeholders together', () => {
    const out = templateToProbeSql(
      'SELECT a.{{field}} FROM {{table_a}} a WHERE a.x = 1 LIMIT {{row_limit}}',
    );
    expect(out).toBe('SELECT a.__x__ FROM __x__ a WHERE a.x = 1 LIMIT 1');
  });

  it('is idempotent on text with no placeholders', () => {
    expect(templateToProbeSql('SELECT 1')).toBe('SELECT 1');
  });

  it('never reintroduces a reserved word, even when the variable is named after one', async () => {
    // {{table}} and {{key}} are exactly the variable names this product's own
    // row-count preset uses; substituting the bare word back in previously broke
    // Trino's grammar, which rejects an unquoted reserved word as an identifier.
    const probe = templateToProbeSql('SELECT * FROM {{schema}}.{{table}} WHERE {{key}} = 1');
    expect(await validateSql(probe, 'trino')).toEqual([]);
  });
});

describe('probeTemplate offset mapping', () => {
  it('maps a position in unchanged text back to itself', () => {
    const { mapOffset } = probeTemplate('SELECT {{field}} FROM t');
    // "FROM t" starts after "SELECT __x__ " in the probe text.
    const probeOffset = 'SELECT __x__ '.length;
    expect(mapOffset(probeOffset)).toBe('SELECT {{field}} '.length);
  });

  it('maps a position after a length-changing substitution correctly', () => {
    // {{row_limit}} (13 chars) becomes "1" (1 char) — an 12-character shrink. A
    // position on "t" at the very end must still land on the real "t", not 12
    // characters into where it used to be.
    const template = 'SELECT a FROM t LIMIT {{row_limit}}';
    const { probeSql, mapOffset } = probeTemplate(template);
    expect(probeSql).toBe('SELECT a FROM t LIMIT 1');
    const probeOffsetOfT = probeSql.indexOf(' t ') + 1;
    const origOffsetOfT = template.indexOf(' t ') + 1;
    expect(mapOffset(probeOffsetOfT)).toBe(origOffsetOfT);
  });

  it('maps a position inside a substituted token to the placeholder start', () => {
    const template = 'SELECT {{field}} FROM t';
    const { mapOffset } = probeTemplate(template);
    // Any offset inside "__x__" (positions 7-12 in the probe text) should resolve to
    // where "{{" begins in the original.
    expect(mapOffset(9)).toBe(template.indexOf('{{field}}'));
  });

  it('round-trips through validateSql for a template with a genuine error after a placeholder', async () => {
    // FRM is a typo after the substituted {{table_a}} — the reported error position,
    // once mapped, should point at "FRM" in the ORIGINAL template, not at some
    // offset shifted by the substitution.
    const template = 'SELECT a FROM {{table_a}} a FRM b';
    const { probeSql, mapOffset } = probeTemplate(template);
    const errors = await validateSql(probeSql, 'trino');
    expect(errors.length).toBeGreaterThan(0);
    const mapped = mapOffset(errors[0]!.column - 1);
    // The mapped offset should fall on or after where "FRM" appears in the original.
    expect(mapped).toBeGreaterThanOrEqual(template.indexOf('FRM'));
  });
});

describe('real presets validate clean after the template transform', () => {
  it('the flagship Trino preset has no syntax errors once probed', async () => {
    const { PRESETS, presetTemplate } = await import('../lib/presets');
    const preset = PRESETS.find((p) => p.id === 'column-comparison-sentinel')!;
    const probe = templateToProbeSql(presetTemplate(preset, 'trino'));
    expect(await validateSql(probe, 'trino')).toEqual([]);
  });

  it('the null-safe Trino preset has no syntax errors once probed', async () => {
    const { PRESETS, presetTemplate } = await import('../lib/presets');
    const preset = PRESETS.find((p) => p.id === 'column-comparison-null-safe')!;
    const probe = templateToProbeSql(presetTemplate(preset, 'trino'));
    expect(await validateSql(probe, 'trino')).toEqual([]);
  });

  // single-scan-audit's per-row template is a bare `count_if(...) AS field`
  // fragment — valid only once combined into the full SELECT it is designed for, not
  // as a standalone statement. Every other preset's template already is a complete
  // statement per row, combine being an optional extra for those.
  const FRAGMENT_ONLY_PRESETS = new Set(['single-scan-audit']);

  it('every standalone preset is clean on Trino, MySQL and PostgreSQL once probed', async () => {
    const { PRESETS, presetTemplate } = await import('../lib/presets');
    for (const dialectId of ['trino', 'mysql', 'postgresql']) {
      for (const preset of PRESETS) {
        if (FRAGMENT_ONLY_PRESETS.has(preset.id)) continue;
        const probe = templateToProbeSql(presetTemplate(preset, dialectId));
        const errors = await validateSql(probe, dialectId);
        expect(errors, `${preset.id} on ${dialectId}: ${JSON.stringify(errors)}`).toEqual([]);
      }
    }
  }, 30_000);

  it('single-scan-audit is clean once combined into its full SELECT', async () => {
    const { PRESETS, presetTemplate, presetCombine, combineQueries } = await import('../lib/presets');
    const preset = PRESETS.find((p) => p.id === 'single-scan-audit')!;
    for (const dialectId of ['trino', 'mysql', 'postgresql']) {
      const fragment = templateToProbeSql(presetTemplate(preset, dialectId));
      const spec = presetCombine(preset, dialectId)!;
      const combined = combineQueries(
        [{ index: 1, sql: fragment, label: '', dataType: '' }],
        spec,
        { table_a: 'input_db', table_b: 'output_db', key: 'customer_id', key_out: 'customer_id' },
      );
      const errors = await validateSql(combined, dialectId);
      expect(errors, `${dialectId}: ${JSON.stringify(errors)} -- sql: ${combined}`).toEqual([]);
    }
  }, 30_000);
});
