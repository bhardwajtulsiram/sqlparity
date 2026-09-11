import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import { highlightSql, type TokenKind } from '../lib/highlight';

const trino = getDialect('athena');
const mysql = getDialect('mysql');

const kindOf = (sql: string, text: string, dialect = trino): TokenKind | undefined =>
  highlightSql(sql, dialect).find((t) => t.text === text)?.kind;

describe('highlighting', () => {
  it('round-trips the original text exactly', () => {
    const sql = "SELECT a, count(*) FROM t -- note\nWHERE b = 'x' AND c > 10";
    expect(
      highlightSql(sql, trino)
        .map((t) => t.text)
        .join(''),
    ).toBe(sql);
  });

  it('marks keywords, identifiers, numbers and strings apart', () => {
    const sql = "SELECT name FROM t WHERE id = 42 AND s = 'x'";
    expect(kindOf(sql, 'SELECT')).toBe('keyword');
    expect(kindOf(sql, 'name')).toBe('identifier');
    expect(kindOf(sql, '42')).toBe('number');
    expect(kindOf(sql, "'x'")).toBe('string');
  });

  it('is case-insensitive about keywords', () => {
    expect(kindOf('select a from t', 'select')).toBe('keyword');
  });

  it('marks a name before a parenthesis as a call', () => {
    expect(kindOf('SELECT coalesce(a, 0) FROM t', 'coalesce')).toBe('function');
  });

  it('does not colour a keyword that only appears inside a string', () => {
    const tokens = highlightSql("SELECT 'SELECT' FROM t", trino);
    expect(tokens.filter((t) => t.kind === 'keyword').map((t) => t.text.trim())).toEqual([
      'SELECT',
      'FROM',
    ]);
  });

  it('keeps a comment in one piece', () => {
    expect(kindOf('-- drop the id column\nSELECT a FROM t', '-- drop the id column')).toBe(
      'comment',
    );
  });

  it('marks a quoted identifier as an identifier, not a string', () => {
    expect(kindOf('SELECT `order id` FROM t', '`order id`', mysql)).toBe('identifier');
    expect(kindOf('SELECT "order id" FROM t', '"order id"')).toBe('identifier');
  });

  it('respects the dialect when deciding where a string ends', () => {
    // MySQL reads \' as an escaped quote, so the literal runs to the second quote.
    const sql = "SELECT 'a\\'b' FROM t";
    expect(highlightSql(sql, mysql).find((t) => t.kind === 'string')?.text).toBe("'a\\'b'");
  });

  it('merges neighbouring tokens of the same kind', () => {
    const tokens = highlightSql('SELECT a FROM t', trino);
    expect(tokens.every((t, i) => i === 0 || tokens[i - 1].kind !== t.kind)).toBe(true);
  });

  it('returns nothing for empty input', () => {
    expect(highlightSql('', trino)).toEqual([]);
  });
});
