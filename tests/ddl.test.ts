import { describe, it, expect, beforeAll } from 'vitest';
import { parseDdl, looksLikeDdl, columnsToGrid, diffColumns, type DdlColumn } from '../lib/ddl';

// The parser is loaded on demand and Vite transforms it the first time, which alone
// can exceed the default 5s test timeout. Warm it once, then give each test room.
beforeAll(async () => {
  await parseDdl('CREATE TABLE warmup (a int)', 'trino');
}, 60_000);

const ATHENA_DDL = `CREATE EXTERNAL TABLE IF NOT EXISTS my_db.customer_snapshot (
  customer_id string,
  customer_segment varchar(50),
  order_count bigint,
  last_order_at timestamp,
  is_active boolean,
  lifetime_value double,
  scores array<int>,
  props map<string,string>,
  amount decimal(38,9)
)
STORED AS PARQUET
LOCATION 's3://bucket/path/';`;

const ANSI_DDL = `CREATE TABLE analytics.orders (
  id BIGINT NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total DECIMAL(10, 2),
  PRIMARY KEY (id)
);`;

describe('looksLikeDdl', () => {
  it('recognises the shapes people paste', () => {
    expect(looksLikeDdl(ATHENA_DDL)).toBe(true);
    expect(looksLikeDdl('create table t (a int)')).toBe(true);
    expect(looksLikeDdl('CREATE OR REPLACE TABLE t (a int)')).toBe(true);
    expect(looksLikeDdl('CREATE TEMPORARY TABLE t (a int)')).toBe(true);
  });

  it('does not fire on a plain field list', () => {
    expect(looksLikeDdl('customer_id\tvarchar\norder_count\tbigint')).toBe(false);
    expect(looksLikeDdl('SELECT * FROM t')).toBe(false);
    expect(looksLikeDdl('')).toBe(false);
  });
});

describe('parsing Athena DDL', () => {
  it('extracts every column with its declared type', async () => {
    const result = await parseDdl(ATHENA_DDL, 'trino');
    expect(result.errors).toEqual([]);
    expect(result.table).toBe('my_db.customer_snapshot');
    expect(result.columns).toEqual([
      { name: 'customer_id', type: 'string', line: 2 },
      { name: 'customer_segment', type: 'varchar(50)', line: 3 },
      { name: 'order_count', type: 'bigint', line: 4 },
      { name: 'last_order_at', type: 'timestamp', line: 5 },
      { name: 'is_active', type: 'boolean', line: 6 },
      { name: 'lifetime_value', type: 'double', line: 7 },
      { name: 'scores', type: 'array<int>', line: 8 },
      { name: 'props', type: 'map<string,string>', line: 9 },
      { name: 'amount', type: 'decimal(38,9)', line: 10 },
    ]);
  });

  it('keeps complex types intact', async () => {
    const { columns } = await parseDdl(ATHENA_DDL, 'trino');
    expect(columns.find((c) => c.name === 'props')?.type).toBe('map<string,string>');
    expect(columns.find((c) => c.name === 'amount')?.type).toBe('decimal(38,9)');
  });
});

describe('parsing ANSI DDL', () => {
  it('extracts columns and ignores constraint clauses', async () => {
    const result = await parseDdl(ANSI_DDL, 'trino');
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'name', 'created_at', 'total']);
    // PRIMARY KEY (id) must not appear as a column.
    expect(result.columns).toHaveLength(4);
  });

  it('preserves precision and scale', async () => {
    const { columns } = await parseDdl(ANSI_DDL, 'trino');
    expect(columns.find((c) => c.name === 'total')?.type).toBe('DECIMAL(10, 2)');
  });
});

describe('parse failures', () => {
  it('reports syntax errors with a position', async () => {
    const result = await parseDdl('CREATE EXTERNAL TABLE t (', 'trino');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.line).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toBeTruthy();
  });

  it('returns nothing for empty input without loading the parser', async () => {
    expect(await parseDdl('   ', 'trino')).toEqual({ columns: [], errors: [] });
  });

  it('finds no columns in a SELECT', async () => {
    const result = await parseDdl('SELECT a, b FROM t', 'trino');
    expect(result.columns).toEqual([]);
  });
});

describe('grid output', () => {
  it('renders the tab-separated shape the generator accepts', async () => {
    const { columns } = await parseDdl(ANSI_DDL, 'trino');
    expect(columnsToGrid(columns).split('\n')[0]).toBe('id\tBIGINT');
  });
});

describe('schema diff', () => {
  const col = (name: string, type: string): DdlColumn => ({ name, type, line: 0 });

  it('classifies added, removed, retyped and unchanged', () => {
    const before = [col('a', 'varchar'), col('b', 'bigint'), col('c', 'double')];
    const after = [col('a', 'varchar'), col('b', 'string'), col('d', 'boolean')];
    const changes = diffColumns(before, after);

    expect(changes).toContainEqual(
      expect.objectContaining({ name: 'a', kind: 'unchanged', before: 'varchar', after: 'varchar' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ name: 'b', kind: 'retyped', before: 'bigint', after: 'string' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ name: 'c', kind: 'removed', before: 'double' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ name: 'd', kind: 'added', after: 'boolean' }),
    );
  });

  it('matches column names case-insensitively', () => {
    const changes = diffColumns([col('Amount', 'int')], [col('amount', 'int')]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('unchanged');
  });

  it('ignores case and padding differences in the type', () => {
    const changes = diffColumns([col('a', 'VARCHAR(50)')], [col('a', ' varchar(50) ')]);
    expect(changes[0]!.kind).toBe('unchanged');
  });

  it('handles an empty side', () => {
    expect(diffColumns([], [col('a', 'int')])).toEqual([
      expect.objectContaining({ name: 'a', kind: 'added', after: 'int' }),
    ]);
  });
});

describe('grammar fallback', () => {
  it('reads Athena DDL even when the selected dialect cannot parse it', async () => {
    // PostgreSQL's grammar has no CREATE EXTERNAL TABLE; the Hive fallback covers it,
    // so the user does not have to match the dialect before pasting.
    const result = await parseDdl(ATHENA_DDL, 'postgresql');
    expect(result.columns.map((c) => c.name)).toContain('customer_segment');
    expect(result.columns).toHaveLength(9);
  });

  it('still parses ordinary DDL with the selected dialect', async () => {
    const result = await parseDdl(ANSI_DDL, 'postgresql');
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'name', 'created_at', 'total']);
  });
});

describe('line numbers on a SQL diff', () => {
  it('reports which line each side declared the column on', async () => {
    const before = await parseDdl(
      'CREATE TABLE t (\n  a int,\n  b bigint\n);',
      'trino',
    );
    const after = await parseDdl(
      'CREATE TABLE t (\n  a int,\n  c double,\n  b string\n);',
      'trino',
    );
    const changes = diffColumns(before.columns, after.columns);

    expect(changes.find((c) => c.name === 'b')).toMatchObject({
      kind: 'retyped',
      beforeLine: 3,
      afterLine: 4,
    });
    expect(changes.find((c) => c.name === 'c')).toMatchObject({ kind: 'added', afterLine: 3 });
  });
});
