import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import { lintSql } from '../lib/lint';

const trino = getDialect('athena');
const rules = (sql: string) => lintSql(sql, trino).map((f) => f.rule);

describe('lintSql', () => {
  it('flags UPDATE with no WHERE', () => {
    expect(rules('UPDATE t SET a = 1')).toContain('update-without-where');
  });

  it('does not flag UPDATE with a WHERE', () => {
    expect(rules('UPDATE t SET a = 1 WHERE id = 5')).not.toContain('update-without-where');
  });

  it('flags DELETE with no WHERE', () => {
    expect(rules('DELETE FROM t')).toContain('delete-without-where');
  });

  it('does not flag DELETE with a WHERE', () => {
    expect(rules('DELETE FROM t WHERE id = 5')).not.toContain('delete-without-where');
  });

  it('flags TRUNCATE unconditionally', () => {
    expect(rules('TRUNCATE TABLE t')).toContain('truncate');
  });

  it('flags DROP TABLE, DATABASE and SCHEMA', () => {
    expect(rules('DROP TABLE t')).toContain('drop');
    expect(rules('DROP DATABASE d')).toContain('drop');
    expect(rules('DROP SCHEMA s')).toContain('drop');
  });

  it('does not flag an ordinary SELECT', () => {
    expect(lintSql('SELECT * FROM t WHERE a = 1 LIMIT 10', trino)).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(lintSql('   ', trino)).toEqual([]);
  });

  it('does not false-positive on column names containing the keywords', () => {
    // updated_at and last_deleted_flag are common column names; the word-boundary
    // check must not treat them as the UPDATE / DELETE keywords.
    expect(rules('SELECT updated_at, last_deleted_flag FROM t')).toEqual([]);
  });

  it('ignores the keywords inside a string literal', () => {
    expect(rules("SELECT 'DELETE FROM t' AS note FROM t")).toEqual([]);
  });

  it('ignores the keywords inside a comment', () => {
    expect(rules('-- old code used to UPDATE t SET a = 1\nSELECT 1')).toEqual([]);
  });

  it('can report more than one finding at once', () => {
    const found = rules('DROP TABLE old_t; TRUNCATE TABLE t2');
    expect(found).toContain('drop');
    expect(found).toContain('truncate');
  });
});

describe('per-statement precision', () => {
  it('does not let a WHERE in one statement mask a missing WHERE in another', () => {
    // This is exactly the shape that a real accident produces: a harmless SELECT with
    // a WHERE, followed by a DELETE that has none. Checking the whole input for "is
    // there a WHERE anywhere" would wrongly clear the DELETE.
    const sql = 'SELECT * FROM t WHERE a = 1; DELETE FROM t';
    expect(rules(sql)).toContain('delete-without-where');
  });

  it('the same, the other way round', () => {
    const sql = 'DELETE FROM t; SELECT * FROM t WHERE a = 1';
    expect(rules(sql)).toContain('delete-without-where');
  });

  it('correctly clears when each statement has its own WHERE', () => {
    const sql = 'DELETE FROM t WHERE id = 1; UPDATE t SET a = 1 WHERE id = 2';
    const found = rules(sql);
    expect(found).not.toContain('delete-without-where');
    expect(found).not.toContain('update-without-where');
  });

  it('reports one finding per offending statement', () => {
    const sql = 'DELETE FROM a; DELETE FROM b';
    expect(rules(sql).filter((r) => r === 'delete-without-where')).toHaveLength(2);
  });

  it('does not split on a semicolon inside a string literal', () => {
    // If splitting were done on the raw text, this single UPDATE would be cut into
    // two fragments at the semicolon inside the string, and the WHERE that follows
    // it would end up attached to the wrong fragment.
    const sql = "UPDATE t SET note = 'a; b' WHERE id = 1";
    expect(rules(sql)).not.toContain('update-without-where');
  });
});
