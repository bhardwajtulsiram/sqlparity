import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { convertSql } from '../lib/convert';
import { getDialect } from '../lib/dialects';
import {
  compareResults,
  engineFor,
  inferSchema,
  isOrdered,
  normaliseCell,
  renderSetup,
  setupFor,
  typeFromName,
  type EngineRows,
} from '../lib/engine-check';
import { openDuckDb, type NodeDuckDb } from './helpers/duckdb-node';

const pgDialect = getDialect('postgresql');
const sqliteDialect = getDialect('sqlite');

const columnsOf = (sql: string, dialectId = 'postgresql') =>
  inferSchema(sql, getDialect(dialectId)).map((t) => ({
    table: t.parts.map((p) => p.value).join('.'),
    columns: t.columns.map((c) => `${c.name.value}:${c.type}`),
  }));

describe('engineFor', () => {
  it('runs only the dialects with an in-browser engine', () => {
    expect(engineFor('postgresql')).toBe('postgres');
    expect(engineFor('sqlite')).toBe('sqlite');
    expect(engineFor('duckdb')).toBe('duckdb');
    expect(engineFor('transactsql')).toBeNull();
    expect(engineFor('snowflake')).toBeNull();
  });
});

describe('inferSchema', () => {
  it('finds a schema-qualified table and types its columns from usage', () => {
    expect(
      columnsOf(`SELECT "customer id", LENGTH(RTRIM("customer name")) AS name_length, CAST("total" AS VARCHAR)
        FROM "sales"."orders" WHERE "created_at" > CURRENT_TIMESTAMP AND "note" = 'O''Brien' LIMIT 10`),
    ).toEqual([
      {
        table: 'sales.orders',
        columns: ['customer id:TEXT', 'customer name:TEXT', 'total:NUMERIC', 'created_at:TIMESTAMP', 'note:TEXT'],
      },
    ]);
  });

  it('routes qualified columns through aliases to the right table', () => {
    expect(
      columnsOf(`SELECT o.id, c.name FROM orders o JOIN customers AS c ON o.customer_id = c.id WHERE o.total > 100`),
    ).toEqual([
      { table: 'orders', columns: ['id:TEXT', 'customer_id:TEXT', 'total:NUMERIC'] },
      { table: 'customers', columns: ['name:TEXT', 'id:TEXT'] },
    ]);
  });

  it('does not create tables for CTEs, subqueries or table functions', () => {
    const tables = columnsOf(`WITH recent AS (SELECT * FROM events WHERE ts > DATE '2026-01-01')
      SELECT r.kind FROM recent r JOIN (SELECT 1 AS x) s ON TRUE CROSS JOIN generate_series(1, 3) g`);
    expect(tables.map((t) => t.table)).toEqual(['events']);
    expect(tables[0]!.columns).toEqual(['ts:DATE']);
  });

  it('is not fooled by FROM inside EXTRACT', () => {
    expect(columnsOf(`SELECT EXTRACT(YEAR FROM created) AS y FROM sales`)).toEqual([
      { table: 'sales', columns: ['created:TIMESTAMP'] },
    ]);
  });

  it('keeps comma-joined tables and their aliases apart', () => {
    expect(columnsOf(`SELECT * FROM orders o, customers c WHERE o.cid = c.id AND c.name LIKE '%x'`)).toEqual([
      { table: 'orders', columns: ['cid:TEXT'] },
      { table: 'customers', columns: ['id:TEXT', 'name:TEXT'] },
    ]);
  });

  it('falls back to the name when usage says nothing', () => {
    expect(typeFromName('is_active')).toBe('BOOLEAN');
    expect(typeFromName('updated_at')).toBe('TIMESTAMP');
    expect(typeFromName('order_date')).toBe('DATE');
    expect(typeFromName('unit_price')).toBe('NUMERIC');
    expect(typeFromName('city')).toBe('TEXT');
  });

  it('reuses literals from the query as sample values, so filters match a row', () => {
    const setup = renderSetup(inferSchema(`SELECT * FROM t WHERE status = 'shipped' AND qty >= 5`, pgDialect));
    expect(setup).toContain(`('shipped', 5)`);
    expect(setup).toContain('(NULL, NULL)');
  });
});

describe('setup and comparison helpers', () => {
  it('turns CREATE SCHEMA into ATTACH for SQLite only', () => {
    const setup = 'CREATE SCHEMA IF NOT EXISTS "sales";\nCREATE TABLE "sales"."o" (a TEXT);';
    expect(setupFor('sqlite', setup)).toContain(`ATTACH ':memory:' AS "sales";`);
    expect(setupFor('postgres', setup)).toBe(setup);
  });

  it('normalises engine-specific spellings of the same value', () => {
    expect(normaliseCell('10.50')).toBe(normaliseCell(10.5));
    expect(normaliseCell(true)).toBe(normaliseCell(1));
    expect(normaliseCell('t')).toBe('1');
    expect(normaliseCell('2026-01-15 00:00:00')).toBe('2026-01-15');
    expect(normaliseCell(new Date(Date.UTC(2026, 0, 15, 9, 30)))).toBe('2026-01-15 09:30:00');
    expect(normaliseCell(12n)).toBe('12');
    expect(normaliseCell(null)).toBe('NULL');
  });

  it('compares unordered results as multisets and ordered ones by position', () => {
    const a: EngineRows = { columns: ['x'], rows: [[1], [2], [2]] };
    const b: EngineRows = { columns: ['x'], rows: [[2], [1], [2]] };
    expect(compareResults(a, b, false).same).toBe(true);
    expect(compareResults(a, b, true).same).toBe(false);
    const c: EngineRows = { columns: ['x'], rows: [[2], [1], [3]] };
    const diff = compareResults(a, c, false);
    expect(diff.onlyLeft).toEqual([['2']]);
    expect(diff.onlyRight).toEqual([['3']]);
    expect(compareResults(a, { columns: ['x', 'y'], rows: [] }, false).columnCountDiffers).toBe(true);
  });

  it('detects a top-level ORDER BY but not one inside a window', () => {
    expect(isOrdered('SELECT * FROM t ORDER BY 1', pgDialect)).toBe(true);
    expect(isOrdered('SELECT row_number() OVER (ORDER BY x) FROM t', pgDialect)).toBe(false);
  });
});

/* -------------------------------------------------- real engines, in Node */

let pg: PGlite;
let duck: NodeDuckDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sqlite3: any;

beforeAll(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  pg = await PGlite.create();
  const init = (await import('@sqlite.org/sqlite-wasm')).default as unknown as (o: object) => Promise<unknown>;
  sqlite3 = await init({ print: () => {}, printErr: () => {} });
  duck = await openDuckDb();
}, 120_000);

afterAll(async () => {
  await pg?.close();
  duck?.close();
});

/** The same isolation the browser uses: a transaction rolled back after each check. */
async function onPostgres(setup: string, sql: string): Promise<EngineRows> {
  await pg.exec('BEGIN');
  try {
    await pg.exec(setupFor('postgres', setup));
    const result = await pg.query<unknown[]>(sql, [], { rowMode: 'array' });
    return { columns: result.fields.map((f) => f.name), rows: result.rows };
  } finally {
    await pg.exec('ROLLBACK');
  }
}

/** A fresh in-memory database per check, since SQLite cannot ATTACH inside a transaction. */
function onSqlite(setup: string, sql: string): EngineRows {
  const db = new sqlite3.oo1.DB(':memory:');
  try {
    db.exec(setupFor('sqlite', setup));
    const rows: unknown[][] = [];
    const columns: string[] = [];
    db.exec({ sql, rowMode: 'array', resultRows: rows, columnNames: columns });
    return { columns, rows };
  } finally {
    db.close();
  }
}

async function onDuckDb(setup: string, sql: string): Promise<EngineRows> {
  duck.exec('BEGIN TRANSACTION');
  try {
    duck.exec(setupFor('duckdb', setup));
    return await duck.query(sql);
  } finally {
    duck.exec('ROLLBACK');
  }
}

describe('generated setup runs on the real engines', () => {
  it("runs the converter's own example after conversion to PostgreSQL", async () => {
    const example = `SELECT TOP 10
  [customer id],
  LEN([customer name]) AS name_length,
  ISNULL([segment], 'unknown') AS segment,
  CAST([total] AS VARCHAR) AS total_text
FROM [sales].[orders]
WHERE [created_at] > GETDATE()
  AND [note] = 'O''Brien'`;
    const converted = convertSql(example, getDialect('transactsql'), pgDialect).sql;
    const setup = renderSetup(inferSchema(converted, pgDialect));
    const result = await onPostgres(setup, converted);
    expect(result.columns).toEqual(['customer id', 'name_length', 'segment', 'total_text']);
    // The sample row is dated after "now" and carries the query's own literal, so the
    // filter keeps it — a check on zero rows would prove much less.
    expect(result.rows).toHaveLength(1);
  }, 60_000);

  it('reports a real error for a function the target does not have', async () => {
    const sql = `SELECT LEN(name) FROM people`;
    const setup = renderSetup(inferSchema(sql, pgDialect));
    await expect(onPostgres(setup, sql)).rejects.toThrow(/len/i);
  }, 60_000);

  const portable = `SELECT o.status, count(*) AS n, sum(o.qty) AS qty
    FROM "shop"."orders" o JOIN customers c ON o.customer_id = c.customer_id
    WHERE o.status = 'shipped' AND c.is_active = TRUE
    GROUP BY o.status ORDER BY o.status`;

  it('runs the same setup on PostgreSQL, SQLite and DuckDB and gets the same answer', async () => {
    const setup = renderSetup(inferSchema(portable, pgDialect));
    const pgRows = await onPostgres(setup, portable);
    const liteSql = convertSql(portable, pgDialect, sqliteDialect).sql;
    const liteRows = onSqlite(setup, liteSql);
    const duckRows = await onDuckDb(setup, convertSql(portable, pgDialect, getDialect('duckdb')).sql);
    expect(pgRows.rows.length).toBeGreaterThan(0);
    expect(compareResults(pgRows, liteRows, true).same).toBe(true);
    expect(compareResults(pgRows, duckRows, true).same).toBe(true);
  }, 60_000);

  it('notices when two engines disagree', async () => {
    // Integer division: 7 / 2 is 3 in PostgreSQL and SQLite, 3.5 in DuckDB.
    const sql = 'SELECT 7 / 2 AS half';
    const pgRows = await onPostgres('', sql);
    const duckRows = await onDuckDb('', sql);
    expect(compareResults(pgRows, duckRows, false).same).toBe(false);
  }, 60_000);
});
