import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { parseDdlSync } from '../lib/ddl';
import { getDialect } from '../lib/dialects';
import {
  columnSpec,
  DEFAULT_TEST_DATA,
  generateRows,
  toCsv,
  toInsertSql,
  toJsonLines,
  type ColumnSpec,
} from '../lib/testdata';
import { openDuckDb, type NodeDuckDb } from './helpers/duckdb-node';

const DDL = `CREATE TABLE customers (
  customer_id bigint NOT NULL,
  full_name varchar(40) NOT NULL,
  email varchar(120),
  country char(2),
  balance numeric(12,2),
  score double precision,
  is_active boolean,
  signup_date date,
  last_seen timestamp,
  notes text
)`;

const specsFrom = (ddl: string, dialectId = 'postgresql'): ColumnSpec[] =>
  parseDdlSync(ddl, dialectId).columns.map(columnSpec);

describe('reading column types', () => {
  it('classifies types and keeps their limits', () => {
    const specs = specsFrom(DDL);
    expect(specs.map((s) => s.kind)).toEqual([
      'integer', 'text', 'text', 'text', 'decimal', 'float', 'boolean', 'date', 'timestamp', 'text',
    ]);
    expect(specs[0]).toMatchObject({ isKey: true, nullable: false, max: '9223372036854775807' });
    expect(specs[1]).toMatchObject({ maxLength: 40, nullable: false });
    expect(specs[4]).toMatchObject({ precision: 12, scale: 2 });
  });

  it('reads other dialects’ spellings', () => {
    expect(columnSpec({ name: 'id', type: 'uniqueidentifier' }).kind).toBe('uuid');
    expect(columnSpec({ name: 'n', type: 'NUMBER(10)' }).kind).toBe('integer');
    expect(columnSpec({ name: 'n', type: 'NUMBER(10,2)' }).kind).toBe('decimal');
    expect(columnSpec({ name: 'n', type: 'Nullable(String)' }).kind).toBe('text');
    expect(columnSpec({ name: 'n', type: 'datetime2(3)' }).kind).toBe('timestamp');
    expect(columnSpec({ name: 'n', type: 'int unsigned' })).toMatchObject({ kind: 'integer', min: '0' });
  });
});

describe('generating rows', () => {
  const specs = specsFrom(DDL);
  const rows = generateRows(specs, { ...DEFAULT_TEST_DATA, rows: 60 });

  it('is deterministic for a seed and changes with it', () => {
    expect(generateRows(specs, { ...DEFAULT_TEST_DATA, rows: 60 })).toEqual(rows);
    expect(generateRows(specs, { ...DEFAULT_TEST_DATA, rows: 60, seed: 7 })).not.toEqual(rows);
  });

  it('puts the traps first, each with its reason', () => {
    const names = rows.map((r) => r[1]!.value);
    expect(names).toContain("O'Brien");
    expect(names).toContain('Thanks 🙂👍');
    expect(rows[0]![1]!.edge).toBe('apostrophe');
    const balances = rows.map((r) => r[4]!.value);
    expect(balances).toContain('9999999999.99');
    expect(rows.map((r) => r[7]!.value)).toContain('2024-02-29');
  });

  it('never makes a value longer than the column allows', () => {
    for (const row of rows) {
      expect([...(row[1]!.value ?? '')].length).toBeLessThanOrEqual(40);
      expect([...(row[3]!.value ?? '')].length).toBeLessThanOrEqual(2);
    }
  });

  it('keeps keys unique and NOT NULL columns filled', () => {
    const ids = rows.map((r) => r[0]!.value);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.every((r) => r[0]!.value !== null && r[1]!.value !== null)).toBe(true);
    expect(rows.some((r) => r.slice(2).every((c) => c.value === null))).toBe(true);
  });

  it('gives a text key a near-duplicate differing only by case', () => {
    const text = specsFrom('CREATE TABLE t (account_code varchar(10) NOT NULL, x int)');
    const keys = generateRows(text, { ...DEFAULT_TEST_DATA, rows: 5 }).map((r) => r[0]!.value);
    expect(keys.slice(0, 2)).toEqual(['K00001', 'k00001']);
  });

  it('writes CSV a parser reads back exactly', () => {
    const csv = toCsv(specs, rows);
    expect(csv.split('\r\n')[0]).toBe('customer_id,full_name,email,country,balance,score,is_active,signup_date,last_seen,notes');
    expect(csv).toContain('"O\'Brien"'.replace('"O\'Brien"', "O'Brien"));
    expect(csv).toContain('"Say ""hello"""');
    expect(csv).toContain('"line one\nline two"');
  });

  it('writes JSON Lines with real numbers and booleans', () => {
    const first = JSON.parse(toJsonLines(specs, rows).split('\n')[0]!);
    expect(typeof first.customer_id).toBe('number');
    expect(first.full_name).toBe("O'Brien");
  });

  it('uses the dialect’s literals', () => {
    // Rows 0-2 are plain ASCII; row 3 carries the accents that need N on SQL Server.
    const one = rows.slice(0, 5);
    expect(toInsertSql('t', specs, one, getDialect('transactsql'))).toContain("N'");
    expect(toInsertSql('t', specs, one, getDialect('mysql'))).toContain("'C:\\\\temp\\\\new'");
    expect(toInsertSql('t', specs, one, getDialect('plsql')).split('\n')[0]).toMatch(/^INSERT INTO "t" .* VALUES \(.*\);$/);
    expect(toInsertSql('t', specs, one, getDialect('trino'))).toContain("DATE '2024-02-29'");
  });
});

/* ------------------------------------- the INSERTs load into real engines */

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

describe('generated INSERTs load into real engines and round-trip', () => {
  const specs = specsFrom(DDL);
  const rows = generateRows(specs, { ...DEFAULT_TEST_DATA, rows: 40 });
  const texts = rows.map((r) => r[1]!.value);

  it('PostgreSQL', async () => {
    await pg.exec(DDL);
    await pg.exec(toInsertSql('customers', specs, rows, getDialect('postgresql')));
    const back = await pg.query<{ full_name: string }>('SELECT full_name FROM customers ORDER BY customer_id');
    expect(back.rows.map((r) => r.full_name)).toEqual(texts);
  }, 60_000);

  it('SQLite', () => {
    const db = new sqlite3.oo1.DB(':memory:');
    db.exec(DDL);
    db.exec(toInsertSql('customers', specs, rows, getDialect('sqlite')));
    const out: unknown[][] = [];
    db.exec({ sql: 'SELECT full_name, is_active FROM customers ORDER BY customer_id', rowMode: 'array', resultRows: out });
    expect(out.map((r) => r[0])).toEqual(texts);
    db.close();
  });

  it('DuckDB', async () => {
    duck.exec(DDL.replace('double precision', 'double'));
    duck.exec(toInsertSql('customers', specs, rows, getDialect('duckdb')));
    const back = await duck.query('SELECT full_name, count(*) OVER () FROM customers ORDER BY customer_id');
    expect(back.rows.map((r) => r[0])).toEqual(texts);
    expect(Number(back.rows[0]![1])).toBe(40);
  });
});
