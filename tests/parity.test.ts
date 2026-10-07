import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assess,
  autoPair,
  DEFAULT_OPTIONS,
  isNumeric,
  mismatchPredicate,
  pickKey,
  SOURCE_TABLE,
  TARGET_TABLE,
  uniquenessQuery,
  valueExpr,
  type ColumnInfo,
  type ParityOptions,
  type ParitySpec,
} from '../lib/parity';
import { displayValue, runParity, showEdges, toCount } from '../lib/parity-run';
import { openDuckDb, type NodeDuckDb } from './helpers/duckdb-node';

let db: NodeDuckDb;

beforeAll(async () => {
  db = await openDuckDb();
}, 60_000);

afterAll(() => db?.close());

/** Load both sides from SQL, then describe them the way the UI does. */
async function load(source: string, target: string): Promise<{ source: ColumnInfo[]; target: ColumnInfo[] }> {
  db.exec(`CREATE OR REPLACE TABLE ${SOURCE_TABLE} AS ${source}`);
  db.exec(`CREATE OR REPLACE TABLE ${TARGET_TABLE} AS ${target}`);
  const describe = async (table: string) =>
    (await db.query(`DESCRIBE ${table}`)).rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }));
  return { source: await describe(SOURCE_TABLE), target: await describe(TARGET_TABLE) };
}

async function check(source: string, target: string, opts: Partial<ParityOptions> = {}, keyNames: string[] | null = ['id']) {
  const cols = await load(source, target);
  const { pairs, onlySource, onlyTarget } = autoPair(cols.source, cols.target);
  const keys = keyNames ? pairs.filter((p) => keyNames.includes(p.source)) : [];
  const spec: ParitySpec = {
    keys,
    compare: pairs.filter((p) => !keys.includes(p)),
    options: { ...DEFAULT_OPTIONS, ...opts },
  };
  const result = await runParity(db.query, spec, {
    unpairedSource: onlySource,
    unpairedTarget: onlyTarget,
    engineVersion: 'test',
  });
  return { result, assessment: assess(result, spec.options), spec };
}

const BASE = `SELECT * FROM (VALUES (1, 'Ada', 10.5), (2, 'Grace', 20.0), (3, 'Edsger', 30.25)) v(id, name, amount)`;

describe('Parity Run against DuckDB', () => {
  it('calls identical tables a match', async () => {
    const { result, assessment } = await check(BASE, BASE);
    expect(result.sourceRows).toBe(3);
    expect(result.keys).toMatchObject({ matched: 3, onlySource: 0, onlyTarget: 0, comparedRows: 3 });
    expect(result.columns.map((c) => c.mismatches)).toEqual([0, 0]);
    expect(assessment.verdict).toBe('match');
    expect(assessment.findings).toEqual([]);
  });

  it('finds a missing key, an extra key and a changed value, with samples', async () => {
    const target = `SELECT * FROM (VALUES (1, 'Ada', 10.5), (2, 'Grace Hopper', 20.0), (4, 'Barbara', 40.0)) v(id, name, amount)`;
    const { result, assessment } = await check(BASE, target);
    expect(result.keys).toMatchObject({ matched: 2, onlySource: 1, onlyTarget: 1 });
    const name = result.columns.find((c) => c.pair.source === 'name')!;
    expect(name.mismatches).toBe(1);
    expect(name.samples).toEqual([{ key: ['2'], source: 'Grace', target: 'Grace Hopper' }]);
    expect(result.onlySourceSamples).toEqual([['3']]);
    expect(result.onlyTargetSamples).toEqual([['4']]);
    expect(assessment.verdict).toBe('differs');
  });

  it('counts a value turned NULL as a difference, and NULL against NULL as equal', async () => {
    const source = `SELECT * FROM (VALUES (1, 'a'), (2, NULL), (3, 'c')) v(id, note)`;
    const target = `SELECT * FROM (VALUES (1, NULL), (2, NULL), (3, 'c')) v(id, note)`;
    const { result } = await check(source, target);
    expect(result.columns[0]!.mismatches).toBe(1);
    expect(result.columns[0]!.samples[0]).toEqual({ key: ['1'], source: 'a', target: 'NULL' });
  });

  it('reports duplicate and empty keys', async () => {
    const target = `SELECT * FROM (VALUES (1, 'Ada', 10.5), (1, 'Ada', 10.5), (2, 'Grace', 20.0), (NULL, 'Edsger', 30.25)) v(id, name, amount)`;
    const { result, assessment } = await check(BASE, target);
    expect(result.keys).toMatchObject({ targetDuplicates: 1, targetNulls: 1, sourceDuplicates: 0, onlySource: 1 });
    expect(assessment.findings.some((f) => f.includes('more than once in the target'))).toBe(true);
    expect(assessment.findings.some((f) => f.includes('empty key'))).toBe(true);
  });

  it('joins an INTEGER key to a VARCHAR key', async () => {
    const target = `SELECT CAST(id AS VARCHAR) AS id, name, amount FROM (${BASE})`;
    const { result, assessment } = await check(BASE, target);
    expect(result.keys).toMatchObject({ matched: 3, onlySource: 0, onlyTarget: 0 });
    expect(assessment.verdict).toBe('match');
  });

  it('compares numbers numerically, so 10.50 equals 10.5 across types', async () => {
    const target = `SELECT id, name, CAST(amount AS DECIMAL(10, 2)) AS amount FROM (${BASE})`;
    const { result } = await check(BASE, target);
    expect(result.columns.find((c) => c.pair.source === 'amount')!.mismatches).toBe(0);
  });

  it('applies a numeric tolerance only when asked', async () => {
    const target = `SELECT id, name, amount + 0.004 AS amount FROM (${BASE})`;
    const strict = await check(BASE, target);
    expect(strict.result.columns.find((c) => c.pair.source === 'amount')!.mismatches).toBe(3);
    const loose = await check(BASE, target, { tolerance: 0.01 });
    expect(loose.result.columns.find((c) => c.pair.source === 'amount')!.mismatches).toBe(0);
    expect(loose.assessment.gaps.join(' ')).toContain('within 0.01');
  });

  it('forgives floating-point noise at the edge of the tolerance', async () => {
    const source = `SELECT * FROM (VALUES (1, 1840.50::DOUBLE), (2, 10.0::DOUBLE)) v(id, amount)`;
    const target = `SELECT * FROM (VALUES (1, 1840.49::DOUBLE), (2, 10.02::DOUBLE)) v(id, amount)`;
    const { result } = await check(source, target, { tolerance: 0.01 });
    // 0.01 apart is within; 0.02 apart is not.
    expect(result.columns[0]!.mismatches).toBe(1);
    expect(result.columns[0]!.samples[0]!.key).toEqual(['2']);
  });

  it('normalises whitespace, case and empty strings only when asked', async () => {
    const source = `SELECT * FROM (VALUES (1, 'Ada'), (2, ''), (3, 'x')) v(id, name)`;
    const target = `SELECT * FROM (VALUES (1, '  ada '), (2, NULL), (3, 'x')) v(id, name)`;
    expect((await check(source, target)).result.columns[0]!.mismatches).toBe(2);
    const relaxed = await check(source, target, { trim: true, ignoreCase: true, emptyAsNull: true });
    expect(relaxed.result.columns[0]!.mismatches).toBe(0);
  });

  it('pairs renamed-case columns and reports the ones it could not pair', async () => {
    const target = `SELECT id AS ID, name AS Name, amount AS total_amount FROM (${BASE})`;
    const { result, assessment } = await check(BASE, target, {}, ['id']);
    expect(result.unpairedSource).toEqual(['amount']);
    expect(result.unpairedTarget).toEqual(['total_amount']);
    expect(assessment.verdict).toBe('match-with-gaps');
  });

  it('calls a run with a column left out by choice a partial match', async () => {
    const cols = await load(BASE, BASE);
    const { pairs } = autoPair(cols.source, cols.target);
    const spec: ParitySpec = { keys: [pairs[0]!], compare: [pairs[1]!], options: DEFAULT_OPTIONS };
    const result = await runParity(db.query, spec, {
      unpairedSource: [],
      unpairedTarget: [],
      excluded: ['amount'],
      engineVersion: 'test',
    });
    const assessment = assess(result, spec.options);
    expect(assessment.verdict).toBe('match-with-gaps');
    expect(assessment.gaps.join(' ')).toContain('by choice: amount');
  });

  it('handles column names that need quoting', async () => {
    const source = `SELECT * FROM (VALUES (1, 'a')) v("order id", "say ""hi""")`;
    const { result, assessment } = await check(source, source, {}, ['order id']);
    expect(result.keys?.matched).toBe(1);
    expect(assessment.verdict).toBe('match');
  });

  it('compares as row multisets when there is no key, counting duplicates', async () => {
    const source = `SELECT * FROM (VALUES ('a', 1), ('a', 1), ('b', 2)) v(code, n)`;
    const target = `SELECT * FROM (VALUES ('a', 1), ('b', 2), ('c', 3)) v(code, n)`;
    const { result, assessment } = await check(source, target, {}, null);
    expect(result.mode).toBe('rows');
    expect(result.rowSets).toEqual({ onlySource: 1, onlyTarget: 1 });
    expect(result.onlySourceSamples).toEqual([['a', '1']]);
    expect(result.onlyTargetSamples).toEqual([['c', '3']]);
    expect(assessment.verdict).toBe('differs');
    expect(assessment.gaps.join(' ')).toContain('No key was chosen');
  });

  it('records every statement it ran, so a report can show them', async () => {
    const { result } = await check(BASE, BASE);
    expect(result.queries.map((q) => q.label)).toEqual([
      'Row counts',
      'Duplicate and empty keys',
      'Key coverage',
      'Column differences on matched rows',
    ]);
  });

  it('measures uniqueness for key suggestions', async () => {
    await load(BASE, BASE);
    const row = (await db.query(uniquenessQuery(SOURCE_TABLE, ['id', 'name']))).rows[0]!;
    expect(row.map(toCount)).toEqual([3, 3, 3, 3, 3]);
  });
});

describe('pairing and keys', () => {
  const col = (name: string, type = 'VARCHAR'): ColumnInfo => ({ name, type });

  it('prefers exact names over looser matches', () => {
    const { pairs } = autoPair([col('Id'), col('id')], [col('id'), col('ID')]);
    expect(pairs.map((p) => `${p.source}->${p.target}`)).toEqual(['Id->ID', 'id->id']);
  });

  it('matches across case and punctuation', () => {
    const { pairs, onlySource, onlyTarget } = autoPair(
      [col('CustomerID'), col('note')],
      [col('customer_id'), col('remarks')],
    );
    expect(pairs.map((p) => p.target)).toEqual(['customer_id']);
    expect(onlySource).toEqual(['note']);
    expect(onlyTarget).toEqual(['remarks']);
  });

  it('picks an identifier-named unique column over another unique one', () => {
    const { pairs } = autoPair([col('created_at'), col('order_id')], [col('created_at'), col('order_id')]);
    expect(pickKey(pairs, new Set(['created_at', 'order_id']))?.source).toBe('order_id');
    expect(pickKey(pairs, new Set(['created_at']))).toBeUndefined();
  });
});

describe('expressions', () => {
  const pair = (sourceType: string, targetType: string) => ({ source: 'x', target: 'x', sourceType, targetType });

  it('recognises numeric types including parameterised decimals', () => {
    expect(isNumeric('DECIMAL(18,2)')).toBe(true);
    expect(isNumeric('BIGINT')).toBe(true);
    expect(isNumeric('VARCHAR')).toBe(false);
  });

  it('casts to text only when the types differ or the column is text', () => {
    expect(valueExpr('s', 'x', 'DATE', 'DATE', DEFAULT_OPTIONS)).toBe('s."x"');
    expect(valueExpr('s', 'x', 'DATE', 'TIMESTAMP', DEFAULT_OPTIONS)).toBe('CAST(s."x" AS VARCHAR)');
    expect(valueExpr('s', 'x', 'VARCHAR', 'VARCHAR', { ...DEFAULT_OPTIONS, trim: true, ignoreCase: true })).toBe(
      'lower(trim(s."x"))',
    );
  });

  it('uses a tolerance predicate only for numeric pairs', () => {
    const opts = { ...DEFAULT_OPTIONS, tolerance: 0.5 };
    expect(mismatchPredicate(pair('DOUBLE', 'DECIMAL(10,2)'), opts)).toContain('abs(');
    expect(mismatchPredicate(pair('VARCHAR', 'VARCHAR'), opts)).toContain('IS DISTINCT FROM');
  });

  it('makes edge whitespace visible in samples', () => {
    expect(showEdges('Alan Turing ')).toBe('Alan Turing␣');
    expect(showEdges('  a b\t')).toBe('␣␣a b⇥');
    expect(showEdges('x\n')).toBe('x↵');
    expect(showEdges('plain')).toBe('plain');
  });

  it('formats values for display', () => {
    expect(displayValue(null)).toBe('NULL');
    expect(displayValue(12n)).toBe('12');
    expect(displayValue(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-02 03:04:05');
  });
});

describe('the built-in example', () => {
  it('loads through the real CSV path and shows every planted difference', async () => {
    const { EXAMPLE_FILES } = await import('../lib/parity-example');
    const { loadTable } = await import('../lib/duckdb');
    await db.registerText('ex-source.csv', EXAMPLE_FILES.source.text);
    await db.registerText('ex-target.csv', EXAMPLE_FILES.target.text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = db.connection as any;
    await loadTable(conn, SOURCE_TABLE, 'ex-source.csv', 'csv');
    await loadTable(conn, TARGET_TABLE, 'ex-target.csv', 'csv');
    const describe = async (table: string) =>
      (await db.query(`DESCRIBE ${table}`)).rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }));
    const { pairs, onlySource, onlyTarget } = autoPair(await describe(SOURCE_TABLE), await describe(TARGET_TABLE));
    const keys = pairs.filter((p) => p.source === 'customer_id');
    const run = async (options: Partial<ParityOptions>) => {
      const spec: ParitySpec = { keys, compare: pairs.filter((p) => !keys.includes(p)), options: { ...DEFAULT_OPTIONS, ...options } };
      const result = await runParity(db.query, spec, { unpairedSource: onlySource, unpairedTarget: onlyTarget, engineVersion: 'test' });
      return { result, assessment: assess(result, spec.options) };
    };

    const strict = await run({});
    expect(onlyTarget).toEqual(['loaded_at']);
    expect(strict.result.keys).toMatchObject({ matched: 11, onlySource: 1, onlyTarget: 1 });
    expect(strict.result.onlySourceSamples).toEqual([['1012']]);
    expect(strict.result.onlyTargetSamples).toEqual([['1013']]);
    const differing = Object.fromEntries(strict.result.columns.map((c) => [c.pair.source, c.mismatches]));
    expect(differing).toEqual({ name: 1, email: 1, country: 1, lifetime_value: 1, signup_date: 0 });

    const relaxed = await run({ trim: true, ignoreCase: true, emptyAsNull: true, tolerance: 0.01 });
    const left = relaxed.result.columns.filter((c) => c.mismatches > 0).map((c) => c.pair.source);
    expect(left).toEqual(['country']);
    expect(relaxed.assessment.verdict).toBe('differs');
  });
});
