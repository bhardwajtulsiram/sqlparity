import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import { scan, replaceToken, countToken } from '../lib/tokenize';

const trino = getDialect('athena');
const mysql = getDialect('mysql');
const tsql = getDialect('mssql');

const kinds = (sql: string, dialect = trino) => scan(sql, dialect).map((s) => `${s.kind}:${s.text}`);

describe('scanning', () => {
  it('treats plain SQL as code', () => {
    expect(kinds('SELECT a FROM t')).toEqual(['code:SELECT a FROM t']);
  });

  it('isolates string literals', () => {
    expect(kinds("SELECT 'x' FROM t")).toEqual(["code:SELECT ", "string:'x'", 'code: FROM t']);
  });

  it('keeps a doubled quote inside the same literal', () => {
    expect(kinds("SELECT 'O''Brien'")).toEqual(['code:SELECT ', "string:'O''Brien'"]);
  });

  it('treats a backslash-escaped quote as part of the literal in MySQL only', () => {
    expect(kinds("SELECT 'a\\'b'", mysql)).toEqual(['code:SELECT ', "string:'a\\'b'"]);
    // In Trino the backslash is ordinary, so the literal ends at the second quote.
    const trinoSegments = scan("SELECT 'a\\'b'", trino);
    expect(trinoSegments.find((s) => s.kind === 'string')?.text).toBe("'a\\'");
  });

  it('isolates line comments', () => {
    expect(kinds('SELECT a -- drop b\nFROM t')).toEqual([
      'code:SELECT a ',
      'comment:-- drop b',
      'code:\nFROM t',
    ]);
  });

  it('isolates block comments', () => {
    expect(kinds('SELECT /* a, b */ c')).toEqual(['code:SELECT ', 'comment:/* a, b */', 'code: c']);
  });

  it('isolates quoted identifiers per dialect', () => {
    expect(kinds('SELECT "my col" FROM t')).toEqual([
      'code:SELECT ',
      'identifier:"my col"',
      'code: FROM t',
    ]);
    expect(kinds('SELECT `my col` FROM t', mysql)).toEqual([
      'code:SELECT ',
      'identifier:`my col`',
      'code: FROM t',
    ]);
    expect(kinds('SELECT [my col] FROM t', tsql)).toEqual([
      'code:SELECT ',
      'identifier:[my col]',
      'code: FROM t',
    ]);
  });

  it('handles an unterminated literal without hanging', () => {
    expect(() => scan("SELECT 'oops", trino)).not.toThrow();
    expect(scan("SELECT 'oops", trino).at(-1)?.kind).toBe('string');
  });

  it('handles an unterminated block comment', () => {
    expect(scan('SELECT /* oops', trino).at(-1)?.kind).toBe('comment');
  });
});

describe('token-aware replacement', () => {
  const column = 'customer_segment';

  it('replaces every occurrence of a whole token', () => {
    const sql = `SELECT a.${column}, b.${column} FROM t`;
    expect(replaceToken(sql, column, 'X', trino)).toBe('SELECT a.X, b.X FROM t');
  });

  it('does not corrupt a longer identifier that contains the token', () => {
    const sql = `SELECT ${column}, ${column}_range FROM t`;
    expect(replaceToken(sql, column, 'X', trino)).toBe('SELECT X, customer_segment_range FROM t');
  });

  it('does not touch the token inside a string literal', () => {
    const sql = `SELECT '${column}' AS label, ${column} FROM t`;
    expect(replaceToken(sql, column, 'X', trino)).toBe(
      `SELECT '${column}' AS label, X FROM t`,
    );
  });

  it('does not touch the token inside a comment', () => {
    const sql = `-- checking ${column}\nSELECT ${column}`;
    expect(replaceToken(sql, column, 'X', trino)).toBe(`-- checking ${column}\nSELECT X`);
  });

  it('does not touch the token inside a quoted identifier', () => {
    const sql = `SELECT "${column}", ${column} FROM t`;
    expect(replaceToken(sql, column, 'X', trino)).toBe(`SELECT "${column}", X FROM t`);
  });

  it('treats a leading token at position zero as whole', () => {
    expect(replaceToken('x + 1', 'x', 'y', trino)).toBe('y + 1');
  });

  it('leaves a token embedded with a leading underscore alone', () => {
    expect(replaceToken('SELECT _x, x', 'x', 'y', trino)).toBe('SELECT _x, y');
  });

  it('returns the input unchanged for an empty token', () => {
    expect(replaceToken('SELECT 1', '', 'y', trino)).toBe('SELECT 1');
  });
});

describe('token counting', () => {
  it('counts only whole tokens in code', () => {
    const sql = "SELECT a, a_x, 'a', /* a */ a FROM t";
    expect(countToken(sql, 'a', trino)).toBe(2);
  });

  it('counts zero when absent', () => {
    expect(countToken('SELECT 1', 'zzz', trino)).toBe(0);
  });

  it('is not confused by SQL containing spaces', () => {
    expect(countToken('SELECT   x   FROM   t', 'x', trino)).toBe(1);
  });
});
