import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import { formatSql, toLeadingCommas, DEFAULT_FORMAT, type FormatSettings } from '../lib/format';

const trino = getDialect('athena');
const mysql = getDialect('mysql');

const settings = (overrides: Partial<FormatSettings> = {}): FormatSettings => ({
  ...DEFAULT_FORMAT,
  ...overrides,
});

describe('formatting', () => {
  it('formats a query and uppercases keywords', () => {
    const { sql, error } = formatSql('select a from t where b=1', trino, settings());
    expect(error).toBeUndefined();
    expect(sql).toMatch(/^SELECT/);
    expect(sql).toMatch(/FROM/);
    expect(sql).toMatch(/WHERE/);
  });

  it('lowercases keywords when asked', () => {
    const { sql } = formatSql('SELECT a FROM t', trino, settings({ keywordCase: 'lower' }));
    expect(sql).toMatch(/^select/);
  });

  it('respects tab width', () => {
    const { sql } = formatSql('select a, b from t', trino, settings({ tabWidth: 4 }));
    expect(sql).toMatch(/\n {4}a/);
  });

  it('uses tabs when asked', () => {
    const { sql } = formatSql('select a, b from t', trino, settings({ useTabs: true }));
    expect(sql).toMatch(/\n\ta/);
  });

  it('formats dialect-specific syntax', () => {
    const { error } = formatSql('SELECT `col` FROM t', mysql, settings());
    expect(error).toBeUndefined();
  });

  it('returns empty output for empty input', () => {
    expect(formatSql('   ', trino, settings()).sql).toBe('');
  });

  it('keeps the user text and reports the problem on unparseable input', () => {
    const input = "SELECT 'unterminated";
    const { sql, error } = formatSql(input, trino, settings());
    expect(sql).toBe(input);
    expect(error).toBeTruthy();
  });
});

describe('leading commas', () => {
  it('moves an end-of-line comma to the next line', () => {
    const input = 'SELECT\n  a,\n  b,\n  c\nFROM t';
    expect(toLeadingCommas(input, trino)).toBe('SELECT\n  a\n, b\n, c\nFROM t');
  });

  it('leaves a comma inside a function call alone', () => {
    const input = 'SELECT\n  coalesce(a, b) AS x,\n  c\nFROM t';
    expect(toLeadingCommas(input, trino)).toBe('SELECT\n  coalesce(a, b) AS x\n, c\nFROM t');
  });

  it('leaves a comma inside a string literal alone', () => {
    // The literal ends the line with a comma, but it is not a separator.
    const input = "SELECT\n  'a,'\nFROM t";
    expect(toLeadingCommas(input, trino)).toBe(input);
  });

  it('leaves a comma ending a comment alone', () => {
    const input = 'SELECT a -- first,\nFROM t';
    expect(toLeadingCommas(input, trino)).toBe(input);
  });

  it('keeps a trailing comma that has no following line', () => {
    const input = 'SELECT\n  a,';
    expect(toLeadingCommas(input, trino)).toBe('SELECT\n  a,');
  });

  it('handles zero indentation', () => {
    expect(toLeadingCommas('a,\nb', trino)).toBe('a\n, b');
  });

  it('does not change SQL that has no line-ending commas', () => {
    const input = 'SELECT a FROM t';
    expect(toLeadingCommas(input, trino)).toBe(input);
  });

  it('is applied through formatSql when selected', () => {
    const { sql } = formatSql(
      'select a, b, c from t',
      trino,
      settings({ commaPosition: 'leading' }),
    );
    expect(sql).toMatch(/\n, b/);
    expect(sql).not.toMatch(/a,\n/);
  });

  it('leaves commas trailing by default', () => {
    const { sql } = formatSql('select a, b from t', trino, settings());
    expect(sql).toMatch(/a,\n/);
  });

  it('moves a comma that sits before a trailing comment', () => {
    expect(toLeadingCommas('SELECT\n  a, -- first\n  b /* second */,\n  c\nFROM t', trino)).toBe(
      'SELECT\n  a -- first\n, b /* second */\n, c\nFROM t',
    );
  });

  it('does not move a comma inside a comment', () => {
    const input = 'SELECT\n  a -- one, two,\n  , b';
    expect(toLeadingCommas(input, trino)).toBe(input);
  });
});

describe('templates', () => {
  it('formats a dbt model without touching the Jinja', () => {
    const { sql, error } = formatSql(
      `select {{ dbt_utils.star(ref('orders')) }} from {{ ref('orders') }} where dt = '{{ var("run_date") }}'`,
      getDialect('snowflake'),
      settings(),
    );
    expect(error).toBeUndefined();
    expect(sql).toContain("{{ dbt_utils.star(ref('orders')) }}");
    expect(sql).toContain("FROM\n  {{ ref('orders') }}");
  });

  it('formats a bulk-generator template with its placeholders', () => {
    const { sql, error } = formatSql(
      'select a.{{key}}, a.{{field}} from {{table_a}} a where a.{{field}} is distinct from b.{{field_out}} limit {{row_limit}}',
      trino,
      settings(),
    );
    expect(error).toBeUndefined();
    expect(sql).toContain('a.{{field}} IS DISTINCT FROM b.{{field_out}}');
  });

  it('keeps Jinja blocks', () => {
    const { sql, error } = formatSql(
      'select id from {{ ref("e") }} {% if is_incremental() %} where dt > 1 {% endif %}',
      getDialect('snowflake'),
      settings(),
    );
    expect(error).toBeUndefined();
    expect(sql).toContain('{% if is_incremental() %}');
    expect(sql).toContain('{% endif %}');
  });

  it('still formats PostgreSQL positional parameters', () => {
    const { error } = formatSql('select * from t where id = $1', getDialect('postgresql'), settings());
    expect(error).toBeUndefined();
  });
});
