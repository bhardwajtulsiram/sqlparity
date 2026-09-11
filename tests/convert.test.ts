import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import { convertSql } from '../lib/convert';

const trino = getDialect('athena');
const mysql = getDialect('mysql');
const tsql = getDialect('transactsql');
const postgres = getDialect('postgresql');
const bigquery = getDialect('bigquery');
const oracle = getDialect('plsql');

const out = (sql: string, from = mysql, to = trino) => convertSql(sql, from, to).sql;
const flags = (sql: string, from = mysql, to = trino) =>
  convertSql(sql, from, to).unconverted.map((u) => u.feature);

describe('identifier quoting', () => {
  it('turns MySQL backticks into double quotes for Trino', () => {
    expect(out('SELECT `order id` FROM `sales`')).toBe('SELECT "order id" FROM "sales"');
  });

  it('turns T-SQL brackets into double quotes', () => {
    expect(out('SELECT [order id] FROM [sales]', tsql, trino)).toBe(
      'SELECT "order id" FROM "sales"',
    );
  });

  it('re-escapes a delimiter that appears inside the identifier', () => {
    expect(out('SELECT `a``b` FROM t')).toBe('SELECT "a`b" FROM t');
  });

  it('leaves identifiers alone when both dialects quote the same way', () => {
    expect(out('SELECT "a" FROM t', postgres, trino)).toBe('SELECT "a" FROM t');
  });

  it('does not touch a backtick inside a string literal', () => {
    expect(out("SELECT '`not an identifier`' FROM t")).toBe("SELECT '`not an identifier`' FROM t");
  });
});

describe('string escaping', () => {
  it('keeps a doubled quote doubled when both dialects double', () => {
    expect(out("SELECT 'O''Brien' FROM t")).toBe("SELECT 'O''Brien' FROM t");
  });

  it('converts a backslash-escaped quote to a doubled one', () => {
    // MySQL accepts \' but Trino does not, and reads the backslash literally.
    expect(out("SELECT 'O\\'Brien' FROM t")).toBe("SELECT 'O''Brien' FROM t");
  });

  it('unescapes a doubled backslash when the target does not escape backslashes', () => {
    expect(out("SELECT 'C:\\\\tmp' FROM t")).toBe("SELECT 'C:\\tmp' FROM t");
  });

  it('escapes a bare backslash when moving into a dialect that reads it as an escape', () => {
    expect(out("SELECT 'C:\\tmp' FROM t", trino, mysql)).toBe("SELECT 'C:\\\\tmp' FROM t");
  });

  it('reports the escaping change it made', () => {
    const result = convertSql("SELECT 'C:\\tmp' FROM t", trino, mysql);
    expect(result.changes.map((c) => c.kind)).toContain('escaping');
  });
});

describe('function names', () => {
  it('renames LEN to LENGTH leaving T-SQL', () => {
    expect(out('SELECT LEN(name) FROM t', tsql, trino)).toBe('SELECT LENGTH(name) FROM t');
  });

  it('renames LENGTH to LEN entering T-SQL', () => {
    expect(out('SELECT LENGTH(name) FROM t', trino, tsql)).toBe('SELECT LEN(name) FROM t');
  });

  it('renames SUBSTR to SUBSTRING entering PostgreSQL', () => {
    expect(out('SELECT SUBSTR(a, 1, 3) FROM t', trino, postgres)).toBe(
      'SELECT SUBSTRING(a, 1, 3) FROM t',
    );
  });

  it('folds IFNULL and NVL into COALESCE', () => {
    expect(out('SELECT IFNULL(a, 0) FROM t')).toBe('SELECT COALESCE(a, 0) FROM t');
    expect(out('SELECT NVL(a, 0) FROM t', oracle, trino)).toBe('SELECT COALESCE(a, 0) FROM t');
  });

  it('reads T-SQL ISNULL as a null default', () => {
    expect(out('SELECT ISNULL(a, 0) FROM t', tsql, trino)).toBe('SELECT COALESCE(a, 0) FROM t');
  });

  it("leaves MySQL's one-argument ISNULL alone, because it means something else", () => {
    expect(out('SELECT ISNULL(a) FROM t')).toBe('SELECT ISNULL(a) FROM t');
  });

  it('translates the current-timestamp spellings', () => {
    expect(out('SELECT NOW() FROM t')).toBe('SELECT CURRENT_TIMESTAMP FROM t');
    expect(out('SELECT GETDATE() FROM t', tsql, trino)).toBe('SELECT CURRENT_TIMESTAMP FROM t');
    expect(out('SELECT CURRENT_TIMESTAMP FROM t', trino, tsql)).toBe('SELECT GETDATE() FROM t');
    expect(out('SELECT SYSDATE FROM dual', oracle, mysql)).toBe('SELECT NOW() FROM dual');
  });

  it('does not rename a function mentioned in a comment', () => {
    expect(out('-- LEN(x) is T-SQL\nSELECT a FROM t', tsql, trino)).toBe(
      '-- LEN(x) is T-SQL\nSELECT a FROM t',
    );
  });

  it('does not rewrite a longer name that merely contains one', () => {
    expect(out('SELECT MY_LENGTH(a) FROM t', trino, tsql)).toBe('SELECT MY_LENGTH(a) FROM t');
  });
});

describe('cast types', () => {
  it('maps VARCHAR to STRING for BigQuery', () => {
    expect(out('SELECT CAST(a AS VARCHAR) FROM t', trino, bigquery)).toBe(
      'SELECT CAST(a AS STRING) FROM t',
    );
  });

  it('maps STRING back to VARCHAR leaving BigQuery', () => {
    expect(out('SELECT CAST(a AS STRING) FROM t', bigquery, trino)).toBe(
      'SELECT CAST(a AS VARCHAR) FROM t',
    );
  });

  it('maps INT to INT64 for BigQuery', () => {
    expect(out('SELECT CAST(a AS INT) FROM t', trino, bigquery)).toBe(
      'SELECT CAST(a AS INT64) FROM t',
    );
  });

  it('maps BOOLEAN to BIT for T-SQL', () => {
    expect(out('SELECT CAST(a AS BOOLEAN) FROM t', trino, tsql)).toBe(
      'SELECT CAST(a AS BIT) FROM t',
    );
  });

  it('does not rename a column alias that happens to share a type name', () => {
    // The alias is not a type, so the AS anchor must not be enough on its own here.
    expect(out('SELECT a AS name FROM t', trino, bigquery)).toBe('SELECT a AS name FROM t');
  });
});

describe('row limits', () => {
  it('turns LIMIT into TOP for T-SQL', () => {
    expect(out('SELECT a FROM t LIMIT 10', trino, tsql)).toBe('SELECT TOP 10 a FROM t');
  });

  it('keeps DISTINCT ahead of the columns when inserting TOP', () => {
    expect(out('SELECT DISTINCT a FROM t LIMIT 10', trino, tsql)).toBe(
      'SELECT DISTINCT TOP 10 a FROM t',
    );
  });

  it('turns TOP into LIMIT leaving T-SQL', () => {
    expect(out('SELECT TOP 10 a FROM t', tsql, trino)).toBe('SELECT a FROM t LIMIT 10');
  });

  it('turns LIMIT into FETCH FIRST for Oracle', () => {
    expect(out('SELECT a FROM t LIMIT 10', trino, oracle)).toBe(
      'SELECT a FROM t FETCH FIRST 10 ROWS ONLY',
    );
  });

  it('turns FETCH FIRST back into LIMIT', () => {
    expect(out('SELECT a FROM t FETCH FIRST 10 ROWS ONLY', oracle, trino)).toBe(
      'SELECT a FROM t LIMIT 10',
    );
  });

  it('carries the offset across', () => {
    expect(out('SELECT a FROM t LIMIT 10 OFFSET 20', trino, oracle)).toBe(
      'SELECT a FROM t OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
    );
  });

  it('keeps the clause before the semicolon', () => {
    expect(out('SELECT a FROM t LIMIT 10;', trino, oracle)).toBe(
      'SELECT a FROM t FETCH FIRST 10 ROWS ONLY;',
    );
  });

  it('refuses to guess where TOP goes when the query has a subquery', () => {
    expect(flags('SELECT a FROM (SELECT a FROM t) s LIMIT 10', trino, tsql)).toContain(
      'LIMIT in a query with more than one SELECT',
    );
  });

  it('refuses to turn an offset into TOP', () => {
    expect(flags('SELECT a FROM t LIMIT 10 OFFSET 20', trino, tsql)).toContain(
      'LIMIT with an offset',
    );
  });

  it('keeps the indentation the author wrote', () => {
    const multiline = 'SELECT\n  a,\n  b\nFROM t\nLIMIT 10';
    expect(out(multiline, trino, oracle)).toBe(
      'SELECT\n  a,\n  b\nFROM t\nFETCH FIRST 10 ROWS ONLY',
    );
  });

  it('puts the new clause on its own line when the query is already multi-line', () => {
    expect(out('SELECT a\nFROM t\nLIMIT 10', trino, oracle)).toBe(
      'SELECT a\nFROM t\nFETCH FIRST 10 ROWS ONLY',
    );
  });

  it('leaves a query with no row cap alone', () => {
    expect(out('SELECT a FROM t', trino, tsql)).toBe('SELECT a FROM t');
  });
});

describe('what it will not translate', () => {
  it('flags CHARINDEX rather than renaming it, because the arguments are reversed', () => {
    const result = convertSql("SELECT CHARINDEX('a', name) FROM t", tsql, trino);
    expect(result.unconverted.map((u) => u.feature)).toContain('CHARINDEX');
    expect(result.sql).toContain('CHARINDEX');
  });

  it('flags DATEDIFF', () => {
    expect(flags('SELECT DATEDIFF(day, a, b) FROM t', tsql, mysql)).toContain('DATEDIFF');
  });

  it('flags string aggregation', () => {
    expect(flags('SELECT GROUP_CONCAT(a) FROM t')).toContain('String aggregation');
  });

  it('flags IS DISTINCT FROM only when the target lacks it', () => {
    expect(flags('SELECT a FROM t WHERE x IS DISTINCT FROM y', trino, mysql)).toContain(
      'IS DISTINCT FROM',
    );
    expect(flags('SELECT a FROM t WHERE x IS DISTINCT FROM y', trino, postgres)).not.toContain(
      'IS DISTINCT FROM',
    );
  });

  it('flags the null-safe operator leaving MySQL', () => {
    expect(flags('SELECT a FROM t WHERE x <=> y')).toContain('<=> (null-safe equality)');
  });

  it('flags QUALIFY, and stays quiet where the target has it', () => {
    expect(flags('SELECT a FROM t QUALIFY row_number() OVER () = 1', bigquery, trino)).toContain(
      'QUALIFY',
    );
    expect(
      flags('SELECT a FROM t QUALIFY row_number() OVER () = 1', bigquery, getDialect('snowflake')),
    ).not.toContain('QUALIFY');
  });

  it('flags a :: cast moving out of the PostgreSQL family', () => {
    expect(flags("SELECT a::text FROM t", postgres, trino)).toContain(':: cast');
  });

  it('flags CONNECT BY leaving Oracle', () => {
    expect(flags('SELECT a FROM t CONNECT BY PRIOR id = parent_id', oracle, trino)).toContain(
      'CONNECT BY',
    );
  });

  it('does not flag a hazard that only appears inside a string', () => {
    expect(flags("SELECT note FROM t WHERE note = 'uses DATEDIFF'", tsql, trino)).not.toContain(
      'DATEDIFF',
    );
  });

  it('every reason says what to do instead', () => {
    const result = convertSql('SELECT DATEDIFF(day, a, b) FROM t', tsql, mysql);
    for (const item of result.unconverted) {
      expect(item.why.length).toBeGreaterThan(40);
    }
  });
});

describe('reporting', () => {
  it('returns the query untouched when both dialects are the same', () => {
    const result = convertSql('SELECT `a` FROM t LIMIT 1', mysql, mysql);
    expect(result.sql).toBe('SELECT `a` FROM t LIMIT 1');
    expect(result.changes).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(convertSql('   ', mysql, trino)).toEqual({ sql: '   ', changes: [], unconverted: [] });
  });

  it('counts repeated changes rather than listing them twice', () => {
    const result = convertSql('SELECT `a`, `b`, `c` FROM `t`', mysql, trino);
    const quoting = result.changes.find((c) => c.kind === 'quoting');
    expect(quoting?.count).toBe(4);
  });

  it('names the spelling it actually found, not the family it belongs to', () => {
    const result = convertSql("SELECT ISNULL(a, 0) FROM t", tsql, trino);
    const fn = result.changes.find((c) => c.kind === 'function');
    expect(fn?.from).toBe('ISNULL()');
    expect(fn?.to).toBe('COALESCE()');
  });

  it('handles a query that needs several kinds of change at once', () => {
    const result = convertSql('SELECT LEN([name]) FROM [t] WHERE x = 1', tsql, trino);
    expect(result.sql).toBe('SELECT LENGTH("name") FROM "t" WHERE x = 1');
    expect(result.changes.map((c) => c.kind).sort()).toEqual(['function', 'quoting']);
  });
});
