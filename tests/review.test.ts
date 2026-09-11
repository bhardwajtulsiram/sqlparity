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
