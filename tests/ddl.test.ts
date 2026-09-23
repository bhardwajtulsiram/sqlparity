import { describe, it, expect } from 'vitest';
import {
  canonicalType,
  columnsToGrid,
  diffColumns,
  looksLikeDdl,
  parseDdl,
  parseDdlSync,
  type DdlColumn,
} from '../lib/ddl';

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

/* ------------------------------------------------ DDL as the engines print it */

const names = (sql: string, dialect = 'trino') => parseDdlSync(sql, dialect).columns.map((c) => c.name);
const typeOf = (sql: string, name: string, dialect = 'trino') =>
  parseDdlSync(sql, dialect).columns.find((c) => c.name === name)?.type;

describe('real DDL from each engine', () => {
  it('reads Athena SHOW CREATE TABLE: backticks gone, structs kept whole, partitions included', () => {
    const sql = [
      'CREATE EXTERNAL TABLE `sales_db`.`customer_snapshot`(',
      "  `customer_id` string COMMENT 'primary key from CRM',",
      "  `customer_segment` varchar(50) COMMENT 'customer\\'s segment',",
      '  `lifetime_value` decimal(18, 2),',
      '  `date` date,',
      '  `address` struct<city:string,zip:string>,',
      '  `attrs` map<string,string>)',
      'PARTITIONED BY (',
      '  `dt` string,',
      '  `region` string)',
      "ROW FORMAT SERDE 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe'",
      "LOCATION 's3://bucket/path'",
      "TBLPROPERTIES ('parquet.compression'='SNAPPY')",
    ].join('\n');
    const result = parseDdlSync(sql, 'trino');
    expect(result.errors).toEqual([]);
    expect(result.table).toBe('sales_db.customer_snapshot');
    expect(result.columns.map((c) => c.name)).toEqual([
      'customer_id',
      'customer_segment',
      'lifetime_value',
      'date',
      'address',
      'attrs',
      'dt',
      'region',
    ]);
    expect(result.columns.find((c) => c.name === 'address')?.type).toBe('struct<city:string,zip:string>');
    expect(result.columns.find((c) => c.name === 'dt')).toMatchObject({ partition: true, line: 9 });
    expect(result.columns[0]).toMatchObject({ quoted: true, line: 2 });
  });

  it('reads an Iceberg table with timestamp(6) and a transform partition', () => {
    const sql = `CREATE TABLE sales_db.orders (
  order_id bigint,
  order_ts timestamp(6),
  amount decimal(12,2))
PARTITIONED BY (day(order_ts))
TBLPROPERTIES ('table_type'='ICEBERG')`;
    const result = parseDdlSync(sql, 'trino');
    expect(result.errors).toEqual([]);
    expect(result.columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'order_id bigint',
      'order_ts timestamp(6)',
      'amount decimal(12,2)',
    ]);
  });

  it('reads pg_dump output', () => {
    const sql = `CREATE TABLE public.customers (
    id bigint NOT NULL,
    name character varying(255),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    tags text[],
    "Mixed Case" integer,
    "order" text
);`;
    const { columns, errors } = parseDdlSync(sql, 'postgresql');
    expect(errors).toEqual([]);
    expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'created_at', 'tags', 'Mixed Case', 'order']);
    expect(columns[2]).toMatchObject({
      type: 'timestamp without time zone',
      defaultValue: 'now()',
      notNull: true,
    });
    expect(columns[3]!.type).toBe('text[]');
  });

  it('reads MySQL SHOW CREATE TABLE and keeps collation out of the type', () => {
    const sql =
      'CREATE TABLE `customers` (\n' +
      '  `id` int(11) unsigned NOT NULL AUTO_INCREMENT,\n' +
      '  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,\n' +
      "  `status` enum('active','closed') NOT NULL DEFAULT 'active',\n" +
      '  `key` varchar(10),\n' +
      '  PRIMARY KEY (`id`),\n' +
      '  KEY `idx_name` (`name`)\n' +
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;';
    const { columns, errors } = parseDdlSync(sql, 'mysql');
    expect(errors).toEqual([]);
    expect(columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'id int(11) unsigned',
      'name varchar(255)',
      "status enum('active','closed')",
      'key varchar(10)',
    ]);
    expect(columns[1]!.collation).toBe('utf8mb4_unicode_ci');
  });

  it('reads Snowflake GET_DDL', () => {
    const sql = `create or replace TABLE ANALYTICS.PUBLIC.CUSTOMERS (
	ID NUMBER(38,0) NOT NULL,
	NAME VARCHAR(16777216),
	CREATED_AT TIMESTAMP_NTZ(9),
	PAYLOAD VARIANT,
	primary key (ID)
);`;
    expect(names(sql, 'snowflake')).toEqual(['ID', 'NAME', 'CREATED_AT', 'PAYLOAD']);
    expect(typeOf(sql, 'CREATED_AT', 'snowflake')).toBe('TIMESTAMP_NTZ(9)');
  });

  it('reads BigQuery DDL with OPTIONS and nested STRUCT', () => {
    const sql =
      'CREATE TABLE `proj.ds.customers`\n(\n  id INT64 NOT NULL,\n' +
      '  name STRING OPTIONS(description="the name"),\n  tags ARRAY<STRING>,\n' +
      '  addr STRUCT<city STRING, zip STRING>,\n  created_at TIMESTAMP\n)\nPARTITION BY DATE(created_at);';
    const result = parseDdlSync(sql, 'bigquery');
    expect(result.errors).toEqual([]);
    expect(result.table).toBe('proj.ds.customers');
    expect(result.columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'id INT64',
      'name STRING',
      'tags ARRAY<STRING>',
      'addr STRUCT<city STRING, zip STRING>',
      'created_at TIMESTAMP',
    ]);
  });

  it('reads a SQL Server script with bracketed names and types', () => {
    const sql = `CREATE TABLE [dbo].[Customers](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[Name] [nvarchar](max) NULL,
	[Balance] [money] NULL,
 CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED ([Id] ASC)
) ON [PRIMARY]
GO`;
    const result = parseDdlSync(sql, 'transactsql');
    expect(result.table).toBe('dbo.Customers');
    expect(result.columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'Id int',
      'Name nvarchar(max)',
      'Balance money',
    ]);
  });

  it('reads Oracle DDL', () => {
    const sql = `CREATE TABLE "HR"."EMPLOYEES"
   (	"EMPLOYEE_ID" NUMBER(6,0) NOT NULL ENABLE,
	"FIRST_NAME" VARCHAR2(20 BYTE),
	"HIRE_DATE" DATE NOT NULL ENABLE
   ) SEGMENT CREATION IMMEDIATE TABLESPACE "USERS" ;`;
    expect(parseDdlSync(sql, 'plsql').columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'EMPLOYEE_ID NUMBER(6,0)',
      'FIRST_NAME VARCHAR2(20 BYTE)',
      'HIRE_DATE DATE',
    ]);
  });

  it('reads Redshift DDL with column encodings', () => {
    const sql = `CREATE TABLE public.events (
  event_id bigint ENCODE az64,
  name varchar(256) ENCODE lzo,
  ts timestamp ENCODE az64
) DISTSTYLE KEY DISTKEY(event_id) SORTKEY(ts);`;
    expect(parseDdlSync(sql, 'redshift').columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'event_id bigint',
      'name varchar(256)',
      'ts timestamp',
    ]);
  });

  it('reads Databricks DDL, where PARTITIONED BY names existing columns', () => {
    const sql = `CREATE TABLE main.sales.orders (
  order_id BIGINT NOT NULL COMMENT 'id',
  dt DATE)
USING delta
PARTITIONED BY (dt)`;
    expect(names(sql, 'spark')).toEqual(['order_id', 'dt']);
  });

  it('reads ClickHouse DDL', () => {
    const sql = `CREATE TABLE db.events (
  id UInt64,
  name Nullable(String) DEFAULT 'x' CODEC(ZSTD),
  tags Array(String)
) ENGINE = MergeTree ORDER BY id`;
    expect(parseDdlSync(sql, 'clickhouse').columns.map((c) => `${c.name} ${c.type}`)).toEqual([
      'id UInt64',
      'name Nullable(String)',
      'tags Array(String)',
    ]);
  });

  it('accepts reserved words as column names', () => {
    expect(names('CREATE TABLE t (user string, order int, timestamp timestamp, comment string)')).toEqual([
      'user',
      'order',
      'timestamp',
      'comment',
    ]);
  });

  it('keeps with time zone in the type', () => {
    expect(typeOf('CREATE TABLE t (a timestamp(3) with time zone)', 'a')).toBe('timestamp(3) with time zone');
  });

  it('reads only the first of several tables, and says so', () => {
    const result = parseDdlSync('CREATE TABLE a (id int, x string);\nCREATE TABLE b (id int, y string);', 'trino');
    expect(result.columns.map((c) => c.name)).toEqual(['id', 'x']);
    expect(result.notes?.[0]).toContain('more than one');
  });

  it('explains a CREATE TABLE AS SELECT', () => {
    const result = parseDdlSync('CREATE TABLE t AS SELECT * FROM s', 'trino');
    expect(result.columns).toEqual([]);
    expect(result.errors[0]!.message).toContain('AS SELECT');
  });

  it('reports a column declared twice', () => {
    const result = parseDdlSync('CREATE TABLE t (a int, A string)', 'trino');
    expect(result.columns).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('twice');
  });

  it('reads a 450-column table quickly', () => {
    const cols = Array.from({ length: 450 }, (_, i) => `  \`col_${i}\` decimal(18,2) COMMENT 'c ${i}'`).join(',\n');
    const started = performance.now();
    const result = parseDdlSync(`CREATE EXTERNAL TABLE t (\n${cols})`, 'trino');
    expect(result.columns).toHaveLength(450);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('comparing types', () => {
  it('ignores spacing inside brackets', () => {
    expect(canonicalType('decimal(18, 2)')).toBe(canonicalType('DECIMAL(18,2)'));
  });

  it('folds exact synonyms', () => {
    expect(canonicalType('integer')).toBe(canonicalType('int'));
    expect(canonicalType('numeric(10,2)')).toBe(canonicalType('decimal(10,2)'));
    expect(canonicalType('character varying(20)')).toBe(canonicalType('varchar(20)'));
  });

  it('keeps types that genuinely differ apart', () => {
    expect(canonicalType('varchar(50)')).not.toBe(canonicalType('string'));
    expect(canonicalType('int')).not.toBe(canonicalType('bigint'));
  });
});

describe('diffing real schemas', () => {
  const diff = (a: string, b: string, dialect = 'trino') =>
    diffColumns(parseDdlSync(a, dialect).columns, parseDdlSync(b, dialect).columns).filter(
      (c) => c.kind !== 'unchanged',
    );

  it('finds nothing between SHOW CREATE TABLE output and the same table written by hand', () => {
    expect(
      diff(
        "CREATE EXTERNAL TABLE `db`.`t`(\n  `customer_id` string,\n  `amount` decimal(18, 2))\nLOCATION 's3://x'",
        'CREATE EXTERNAL TABLE db.t (\n  customer_id string,\n  amount decimal(18,2)\n)',
      ),
    ).toEqual([]);
  });

  it('reports one row for a struct whose members changed', () => {
    const changes = diff(
      'CREATE TABLE t (addr struct<city:string,zip:string>)',
      'CREATE TABLE t (addr struct<city:string,zip:int>)',
    );
    expect(changes).toEqual([expect.objectContaining({ name: 'addr', kind: 'retyped' })]);
  });

  it('reports columns that swapped position', () => {
    const changes = diff(
      'CREATE TABLE t (a string, b string, c string)',
      'CREATE TABLE t (b string, a string, c string)',
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'moved', attributes: [{ key: 'position' }] });
  });

  it('reports nullability, default and collation changes', () => {
    const changes = diff(
      "CREATE TABLE t (id bigint NOT NULL, s text DEFAULT 'x', n varchar(10) COLLATE utf8_bin)",
      'CREATE TABLE t (id bigint, s text, n varchar(10))',
      'mysql',
    );
    expect(changes.map((c) => [c.name, c.kind, c.attributes?.map((a) => a.key)])).toEqual([
      ['id', 'attributes', ['NOT NULL']],
      ['s', 'attributes', ['DEFAULT']],
      ['n', 'attributes', ['COLLATE']],
    ]);
  });

  it('does not invent removed columns from syntax another engine would reject', () => {
    expect(
      diff(
        'CREATE TABLE t (id bigint ENCODE az64, name varchar(10) ENCODE lzo, ts timestamp)',
        'CREATE TABLE t (id bigint, name varchar(10), ts timestamp(6))',
        'redshift',
      ).map((c) => `${c.name}:${c.kind}`),
    ).toEqual(['ts:retyped']);
  });
});
