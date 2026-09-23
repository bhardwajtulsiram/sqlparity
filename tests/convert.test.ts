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
  it('turns LEN into LENGTH of the trimmed value leaving T-SQL, since LEN ignores trailing spaces', () => {
    expect(out('SELECT LEN(name) FROM t', tsql, trino)).toBe('SELECT LENGTH(RTRIM(name)) FROM t');
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

  it('puts TOP on the SELECT the LIMIT belongs to when there is a subquery', () => {
    expect(out('SELECT a FROM (SELECT a FROM t) s LIMIT 10', trino, tsql)).toBe(
      'SELECT TOP 10 a FROM (SELECT a FROM t) s',
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
    expect(result.sql).toBe('SELECT LENGTH(RTRIM("name")) FROM "t" WHERE x = 1');
    expect(result.changes.map((c) => c.kind).sort()).toEqual(['function', 'quoting']);
  });
});

/* ------------------------------------------------------------- real queries */

const hive = getDialect('hive');
const spark = getDialect('spark');

describe('strings written in double quotes', () => {
  it('reads "O\'Brien" in Hive as a string and writes it single-quoted', () => {
    expect(out(`SELECT id FROM sales WHERE status = "active" AND name = "O'Brien"`, hive, trino)).toBe(
      "SELECT id FROM sales WHERE status = 'active' AND name = 'O''Brien'",
    );
  });

  it('keeps MySQL backslash escapes inside double-quoted strings', () => {
    expect(out('SELECT "say \\"hi\\""', mysql, postgres)).toBe(`SELECT 'say "hi"'`);
  });
});

describe('BigQuery paths', () => {
  it('splits a backticked project.dataset.table into its parts', () => {
    expect(out('SELECT id FROM `my-proj.sales.orders`', bigquery, trino)).toBe(
      'SELECT id FROM "my-proj"."sales"."orders"',
    );
  });
});

describe('row caps at every nesting level', () => {
  it('keeps an inner LIMIT with its subquery when moving to FETCH FIRST', () => {
    expect(
      out('SELECT * FROM (SELECT id FROM orders ORDER BY total DESC LIMIT 5) t LIMIT 100', trino, oracle),
    ).toBe(
      'SELECT * FROM (SELECT id FROM orders ORDER BY total DESC FETCH FIRST 5 ROWS ONLY) t FETCH FIRST 100 ROWS ONLY',
    );
  });

  it('puts TOP on each SELECT that had a LIMIT', () => {
    expect(out('SELECT id FROM (SELECT id FROM orders ORDER BY total DESC LIMIT 5) t', postgres, tsql)).toBe(
      'SELECT id FROM (SELECT TOP 5 id FROM orders ORDER BY total DESC) t',
    );
  });

  it('reads MySQL LIMIT offset, count the right way round', () => {
    expect(out('SELECT id FROM orders ORDER BY id LIMIT 20, 10', mysql, postgres)).toBe(
      'SELECT id FROM orders ORDER BY id LIMIT 10 OFFSET 20',
    );
  });

  it('refuses TOP n PERCENT and TOP (@n)', () => {
    const percent = convertSql('SELECT TOP 10 PERCENT id FROM t ORDER BY id', tsql, postgres);
    expect(percent.sql).toBe('SELECT TOP 10 PERCENT id FROM t ORDER BY id');
    expect(percent.unconverted.map((u) => u.feature)).toContain('TOP … PERCENT');
    expect(flags('SELECT TOP (@n) id FROM t', tsql, postgres)).toContain('TOP with an expression');
  });

  it('will not move a cap onto one branch of a UNION', () => {
    expect(flags('SELECT a FROM x UNION ALL SELECT a FROM y LIMIT 10', trino, tsql)).toContain(
      'LIMIT on a UNION',
    );
  });

  it('leaves a LIMIT inside a string or comment alone', () => {
    expect(out("SELECT 'LIMIT 5' AS x FROM t -- LIMIT 3\nLIMIT 10", trino, oracle)).toBe(
      "SELECT 'LIMIT 5' AS x FROM t -- LIMIT 3\nFETCH FIRST 10 ROWS ONLY",
    );
  });
});

describe('functions that are not simple renames', () => {
  it('keeps SUBSTRING … FROM … FOR, which SUBSTR cannot express', () => {
    expect(out('SELECT SUBSTRING(name FROM 2 FOR 3) FROM customers', postgres, trino)).toBe(
      'SELECT SUBSTRING(name FROM 2 FOR 3) FROM customers',
    );
    expect(flags('SELECT SUBSTRING(name FROM 2 FOR 3) FROM customers', postgres, bigquery)).toContain(
      'SUBSTRING … FROM … FOR',
    );
  });

  it('turns MySQL SYSDATE() into a valid current timestamp and drops FROM dual', () => {
    expect(out('SELECT SYSDATE() FROM dual', mysql, postgres)).toBe('SELECT CURRENT_TIMESTAMP');
  });

  it('counts characters, not bytes, going into MySQL', () => {
    expect(out('SELECT LENGTH(name) FROM t', trino, mysql)).toBe('SELECT CHAR_LENGTH(name) FROM t');
    expect(flags('SELECT LENGTH(name) FROM t', mysql, trino)).toContain('LENGTH (bytes in MySQL)');
  });
});

describe('types in CAST', () => {
  it('does not rename a column alias that shares a type name', () => {
    expect(out('SELECT name AS text, id AS int FROM t', postgres, bigquery)).toBe(
      'SELECT name AS text, id AS int FROM t',
    );
  });

  it('keeps a length where the target type takes one', () => {
    expect(out('SELECT CAST(id AS VARCHAR(50)) FROM t', trino, hive)).toBe('SELECT CAST(id AS VARCHAR(50)) FROM t');
    expect(out('SELECT CAST(id AS VARCHAR) FROM t', trino, hive)).toBe('SELECT CAST(id AS STRING) FROM t');
  });

  it('drops MAX where the target has no such length', () => {
    expect(out('SELECT CAST(note AS NVARCHAR(MAX)) FROM t', tsql, postgres)).toBe(
      'SELECT CAST(note AS VARCHAR) FROM t',
    );
  });

  it('gives SQL Server an explicit length, since a bare VARCHAR there is 30 characters', () => {
    expect(out('SELECT CAST(note AS VARCHAR) FROM t', trino, tsql)).toBe('SELECT CAST(note AS NVARCHAR(MAX)) FROM t');
  });

  it('gives Oracle a VARCHAR2 length', () => {
    expect(out('SELECT CAST(note AS VARCHAR) FROM t', trino, oracle)).toBe(
      'SELECT CAST(note AS VARCHAR2(4000)) FROM t',
    );
  });
});

describe('what changes the answer without an error', () => {
  it('flags || going into MySQL, where it means OR', () => {
    expect(flags("SELECT first_name || ' ' || last_name FROM customers", trino, mysql)).toContain(
      '|| concatenation',
    );
  });

  it('flags division between engines that divide whole numbers differently', () => {
    expect(flags('SELECT total_cents / 100 FROM orders', trino, mysql)).toContain('Division');
    expect(flags('SELECT total_cents / 100 FROM orders', trino, postgres)).not.toContain('Division');
  });

  it('flags array subscripts between 1-based and 0-based engines', () => {
    expect(flags('SELECT tags[1] FROM t', trino, bigquery)).toContain('Array subscript');
    expect(flags('SELECT ARRAY[1, 2] FROM t', trino, postgres)).not.toContain('Array subscript');
  });

  it('flags date functions, naming the ones it found', () => {
    expect(flags("SELECT date_add('day', 7, d), date_trunc('month', d) FROM t", trino, hive)).toContain(
      'Date functions (DATE_ADD, DATE_TRUNC)',
    );
  });

  it('flags ILIKE and IF() where the target lacks them', () => {
    expect(flags("SELECT * FROM t WHERE name ILIKE 'acme%'", postgres, trino)).toContain('ILIKE');
    expect(flags("SELECT IF(a > 0, 'pos', 'neg') FROM t", mysql, postgres)).toContain('IF()');
    expect(flags("SELECT IF(a > 0, 'pos', 'neg') FROM t", mysql, spark)).not.toContain('IF()');
  });

  it('describes a backslash-only escaping change in words', () => {
    const result = convertSql("SELECT 'C:\\\\data' AS p", mysql, trino);
    const escaping = result.changes.find((c) => c.kind === 'escaping');
    expect(escaping?.from).toContain('backslash escapes');
    expect(escaping?.to).toContain('backslash is literal');
  });
});
