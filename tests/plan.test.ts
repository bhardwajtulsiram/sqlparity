import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDialect } from '../lib/dialects';
import { explainSql, isExplainable, parsePlan, type PlanStep } from '../lib/plan';
import { openDuckDb, type NodeDuckDb } from './helpers/duckdb-node';

let db: NodeDuckDb;

beforeAll(async () => {
  db = await openDuckDb();
  db.exec("CREATE TABLE orders AS SELECT range AS id, range % 7 AS segment, 'n' || range AS note, range * 1.5 AS total FROM range(50000)");
  db.exec('CREATE TABLE customers AS SELECT range AS id, range % 3 AS tier FROM range(2000)');
}, 60_000);

afterAll(() => db?.close());

/** Profile a query on the real engine and parse it, as the scratchpad does. */
async function plan(sql: string, fold = true) {
  const result = await db.query(explainSql(sql));
  const json = String(result.rows[0]![result.rows[0]!.length - 1]);
  return parsePlan(json, fold);
}

function flatten(step: PlanStep): PlanStep[] {
  return [step, ...step.children.flatMap(flatten)];
}

describe('reading a query plan', () => {
  it('names the steps a person would recognise, with rows and time', async () => {
    const p = await plan(
      'SELECT o.segment, count(*) FROM orders o JOIN customers c ON o.id = c.id WHERE o.note LIKE \'%9\' GROUP BY o.segment ORDER BY 1',
    );
    const labels = flatten(p.root).map((s) => s.label);
    expect(labels).toContain('Join');
    expect(labels).toContain('Group');
    expect(labels).toContain('Sort');
    expect(labels.filter((l) => l === 'Scan table')).toHaveLength(2);
    expect(p.rowsReturned).toBe(7);
    expect(p.totalMs).toBeGreaterThan(0);
    const shares = flatten(p.root).reduce((sum, s) => sum + s.share, 0);
    expect(shares).toBeCloseTo(1, 5);
  });

  it('says what each step did, without the engine’s internal wrappers', async () => {
    const p = await plan('SELECT o.segment, count(*) FROM orders o JOIN customers c ON o.id = c.id GROUP BY o.segment');
    const join = flatten(p.root).find((s) => s.label === 'Join')!;
    expect(join.summary).toMatch(/inner join on/i);
    const scans = flatten(p.root).filter((s) => s.label === 'Scan table').map((s) => s.summary);
    expect(scans.some((s) => s.startsWith('orders'))).toBe(true);
    expect(JSON.stringify(p)).not.toContain('__internal_');
  });

  it('folds column-only steps, and can show them', async () => {
    const sql = 'SELECT segment + 1 AS s, total * 2 AS t FROM orders WHERE id < 10';
    const folded = await plan(sql);
    const full = await plan(sql, false);
    expect(flatten(folded.root).some((s) => s.operator === 'PROJECTION')).toBe(false);
    expect(flatten(full.root).some((s) => s.operator === 'PROJECTION')).toBe(true);
    expect(flatten(folded.root).reduce((sum, s) => sum + s.folded, 0)).toBeGreaterThan(0);
  });

  it('warns about a join that compares every row with every row', async () => {
    const p = await plan('SELECT count(*) FROM orders o, customers c WHERE o.id < 100 AND c.id < 100');
    const warn = p.insights.find((i) => i.tone === 'warn');
    expect(warn?.title).toMatch(/every row is compared with every row/);
  });

  it('points out a scan that reads far more than it keeps', async () => {
    const p = await plan("SELECT * FROM orders WHERE note = 'n42'");
    expect(p.insights.some((i) => /reads 50,000 rows to keep 1/.test(i.title))).toBe(true);
  });

  it('only explains a single statement that reads, because profiling runs it', () => {
    const duck = getDialect('duckdb');
    expect(isExplainable('-- a note first\nSELECT * FROM orders', duck)).toBe(true);
    expect(isExplainable('WITH x AS (SELECT 1) SELECT * FROM x;', duck)).toBe(true);
    expect(isExplainable('SELECT 1; DELETE FROM orders', duck)).toBe(false);
    expect(isExplainable('DELETE FROM orders', duck)).toBe(false);
    expect(isExplainable("SELECT ';' AS semicolon_in_a_string", duck)).toBe(true);
  });

  it('builds the statement only around a single query', () => {
    expect(explainSql('SELECT 1;  ')).toBe('EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1');
  });
});
