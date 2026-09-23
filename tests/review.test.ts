import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import { reviewSql } from '../lib/review';

const trino = getDialect('athena');
const rules = (sql: string) => reviewSql(sql, trino).map((f) => f.rule);

describe('finds the expensive shapes', () => {
  it('flags SELECT *', () => {
    expect(rules('SELECT * FROM orders WHERE id = 1')).toContain('select-star');
  });

  it('flags a leading-wildcard LIKE', () => {
    expect(rules("SELECT a FROM t WHERE name LIKE '%smith'")).toContain('leading-wildcard-like');
  });

  it('flags a function wrapped around the filtered column', () => {
    expect(rules("SELECT a FROM t WHERE date(created_at) = '2026-01-01'")).toContain(
      'function-on-filtered-column',
    );
  });

  it('flags NOT IN with a subquery', () => {
    expect(rules('SELECT a FROM t WHERE id NOT IN (SELECT id FROM u)')).toContain(
      'not-in-subquery',
    );
  });

  it('flags a comma join', () => {
    expect(rules('SELECT a FROM t, u WHERE t.id = u.id')).toContain('comma-join');
  });

  it('flags COUNT(DISTINCT …)', () => {
    expect(rules('SELECT count(DISTINCT user_id) FROM t WHERE a = 1')).toContain('count-distinct');
  });

  it('flags ORDER BY with no LIMIT', () => {
    expect(rules('SELECT a FROM t WHERE x = 1 ORDER BY a')).toContain('order-by-no-limit');
  });

  it('flags a query with no WHERE at all', () => {
    expect(rules('SELECT a FROM big_table')).toContain('no-filter');
  });
});

describe('does not flag what is fine', () => {
  it('leaves a narrow, well-shaped query alone', () => {
    expect(reviewSql('SELECT id, name FROM t WHERE dt = DATE \'2026-01-01\' LIMIT 100', trino)).toEqual(
      [],
    );
  });

  it('does not flag ORDER BY when a LIMIT is present', () => {
    expect(rules('SELECT a FROM t WHERE x = 1 ORDER BY a LIMIT 10')).not.toContain(
      'order-by-no-limit',
    );
  });

  it('does not flag ORDER BY when the dialect uses FETCH FIRST', () => {
    expect(
      rules('SELECT a FROM t WHERE x = 1 ORDER BY a FETCH FIRST 10 ROWS ONLY'),
    ).not.toContain('order-by-no-limit');
  });

  it('does not treat an explicit JOIN as a comma join', () => {
    expect(rules('SELECT a FROM t JOIN u ON t.id = u.id WHERE t.x = 1')).not.toContain('comma-join');
  });

  it('does not flag a select list comma as a join', () => {
    expect(rules('SELECT a, b, c FROM t WHERE x = 1')).not.toContain('comma-join');
  });

  it('does not demand a WHERE on an information_schema lookup', () => {
    expect(rules('SELECT table_name FROM information_schema.tables')).not.toContain('no-filter');
  });

  it('returns nothing for empty input', () => {
    expect(reviewSql('   ', trino)).toEqual([]);
  });
});

describe('reporting', () => {
  it('ignores patterns that only appear inside a string or comment', () => {
    expect(rules("SELECT id FROM t WHERE note = 'SELECT * FROM everything' AND x = 1")).not.toContain(
      'select-star',
    );
    expect(rules('-- avoid SELECT * here\nSELECT id FROM t WHERE x = 1')).not.toContain(
      'select-star',
    );
  });

  it('reports a rule once even when several statements trip it', () => {
    const found = rules('SELECT * FROM a WHERE x=1; SELECT * FROM b WHERE y=2');
    expect(found.filter((r) => r === 'select-star')).toHaveLength(1);
  });

  it('orders findings by severity, worst first', () => {
    const found = reviewSql(
      'SELECT DISTINCT * FROM t WHERE id NOT IN (SELECT id FROM u)',
      trino,
    );
    const severities = found.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) =>
      ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b],
    ));
    expect(severities[0]).toBe('high');
  });

  it('every finding explains why and what to do', () => {
    for (const finding of reviewSql('SELECT * FROM t', trino)) {
      expect(finding.why.length).toBeGreaterThan(30);
      expect(finding.fix.length).toBeGreaterThan(20);
    }
  });
});

describe('SELECT * variants', () => {
  it('flags SELECT DISTINCT *, which still reads every column', () => {
    expect(rules('SELECT DISTINCT * FROM t WHERE x = 1')).toContain('select-star');
  });

  it('flags SELECT TOP 10 *', () => {
    expect(rules('SELECT TOP 10 * FROM t WHERE x = 1')).toContain('select-star');
    expect(rules('SELECT TOP (10) * FROM t WHERE x = 1')).toContain('select-star');
  });

  it('flags SELECT ALL *', () => {
    expect(rules('SELECT ALL * FROM t WHERE x = 1')).toContain('select-star');
  });

  it('does not mistake a multiplication for a star select', () => {
    expect(rules('SELECT a * b AS product FROM t WHERE x = 1')).not.toContain('select-star');
  });

  it('still ignores a star inside a string', () => {
    expect(rules("SELECT id FROM t WHERE note = 'SELECT * FROM x' AND y = 1")).not.toContain(
      'select-star',
    );
  });

  it('flags t.*, which reads every column of t', () => {
    expect(rules("SELECT o.* FROM orders o WHERE o.dt = '2026-01-01'")).toContain('select-star');
  });

  it('does not flag SELECT * inside EXISTS, which reads no columns', () => {
    expect(
      rules("SELECT id FROM a WHERE EXISTS (SELECT * FROM b WHERE b.id = a.id) AND a.dt = '2026-01-01'"),
    ).not.toContain('select-star');
  });

  it('does not flag count(*)', () => {
    expect(rules('SELECT count(*) FROM t WHERE x = 1')).not.toContain('select-star');
  });
});

describe('real queries, read by their structure', () => {
  it('does not treat ORDER BY inside a window function as the query sorting', () => {
    const dedupe = `SELECT id, name FROM (
      SELECT id, name, row_number() OVER (PARTITION BY id ORDER BY updated_at DESC) AS rn
      FROM customers WHERE dt = '2026-01-01') x
    WHERE rn = 1`;
    expect(rules(dedupe)).not.toContain('order-by-no-limit');
  });

  it('does not treat ORDER BY inside an aggregate as the query sorting', () => {
    expect(
      rules("SELECT id, string_agg(name, ',' ORDER BY name) FROM t WHERE dt = '2026-01-01' GROUP BY id"),
    ).not.toContain('order-by-no-limit');
  });

  it('does not read a UNION of two filtered selects as a comma join', () => {
    expect(rules('SELECT a, b FROM t1 WHERE x = 1 UNION ALL SELECT a, b FROM t2 WHERE x = 2')).not.toContain(
      'comma-join',
    );
  });

  it('does not read UNNEST after a comma as a join', () => {
    expect(rules('SELECT t.id, u.tag FROM t, UNNEST(t.tags) AS u(tag) WHERE t.x = 1')).not.toContain(
      'comma-join',
    );
  });

  it('flags a comma join even with no WHERE at all', () => {
    expect(rules('SELECT a FROM t, u')).toContain('comma-join');
  });

  it('sees a function around a quoted column name', () => {
    expect(rules(`SELECT "id" FROM "db"."orders" WHERE date("created_at") = DATE '2026-01-01'`)).toContain(
      'function-on-filtered-column',
    );
  });

  it('sees a function around a column in either argument position', () => {
    expect(rules("SELECT id FROM t WHERE date_trunc('day', ts) = DATE '2026-01-01'")).toContain(
      'function-on-filtered-column',
    );
  });

  it('sees it inside brackets and next to BETWEEN', () => {
    expect(rules("SELECT id FROM t WHERE (x = 1 OR year(d) = 2026)")).toContain('function-on-filtered-column');
    expect(rules("SELECT id FROM t WHERE date(ts) BETWEEN DATE '2026-01-01' AND DATE '2026-01-31'")).toContain(
      'function-on-filtered-column',
    );
  });

  it('does not flag two columns compared through the same function', () => {
    const check = `SELECT a.customer_id FROM input_db a JOIN output_db b ON a.customer_id = b.customer_id
      WHERE coalesce(a.segment, '~') <> coalesce(b.segment, '~') LIMIT 10`;
    expect(rules(check)).not.toContain('function-on-filtered-column');
  });

  it('does not flag a function applied to the constant side', () => {
    expect(rules("SELECT id FROM t WHERE dt = cast('2026-01-01' AS date)")).not.toContain(
      'function-on-filtered-column',
    );
  });

  it('flags ILIKE with a leading wildcard', () => {
    expect(reviewSql("SELECT id FROM t WHERE name ILIKE '%acme%'", getDialect('postgresql')).map((f) => f.rule)).toContain(
      'leading-wildcard-like',
    );
  });

  it('flags an unfiltered table even when a CTE has a WHERE', () => {
    expect(
      rules(`WITH recent AS (SELECT id FROM small WHERE dt = '2026-01-01')
        SELECT r.id, e.payload FROM recent r JOIN events e ON e.id = r.id`),
    ).toContain('no-filter');
  });

  it('does not ask for a WHERE when only a CTE is read', () => {
    expect(rules(`WITH recent AS (SELECT id FROM small WHERE dt = '2026-01-01') SELECT id FROM recent`)).not.toContain(
      'no-filter',
    );
  });

  it('reads Hive double-quoted strings as strings', () => {
    const hive = getDialect('hive');
    expect(
      reviewSql(`SELECT id FROM t WHERE name = "O'Brien" AND dt = '2026-01-01'`, hive).map((f) => f.rule),
    ).toEqual([]);
  });

  it('stays fast on a large pasted file', () => {
    const many = Array.from(
      { length: 400 },
      (_, i) =>
        `SELECT 'col_${i}' AS field, count(*) AS mismatches FROM input_db a JOIN output_db b ON a.id = b.id WHERE coalesce(a.col_${i}, '~') <> coalesce(b.col_${i}, '~')`,
    ).join(';\n');
    const started = performance.now();
    reviewSql(many, trino);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
