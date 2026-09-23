import type { Dialect } from './dialects';

/**
 * A minimal, string- and comment-aware SQL scanner.
 *
 * This is deliberately not a parser. It answers one question — "is this character
 * part of code, or is it inside a string, comment or quoted identifier?" — which is
 * all that token-aware find/replace and the leading-comma pass need.
 *
 * A regex cannot answer that question. `SELECT 'a, b'` has a comma that must not be
 * treated as a separator, and `-- drop the id column` has words that must not be
 * treated as identifiers.
 */

export type SegmentKind = 'code' | 'string' | 'comment' | 'identifier';

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
  text: string;
}

export function scan(sql: string, dialect: Dialect): Segment[] {
  const segments: Segment[] = [];
  const { open: identOpen, close: identClose } = dialect.identifier;
  const lineComments = [...dialect.lineComments].sort((a, b) => b.length - a.length);

  let i = 0;
  let codeStart = 0;

  const flushCode = (end: number) => {
    if (end > codeStart) {
      segments.push({ kind: 'code', start: codeStart, end, text: sql.slice(codeStart, end) });
    }
  };

  const push = (kind: SegmentKind, start: number, end: number) => {
    segments.push({ kind, start, end, text: sql.slice(start, end) });
    codeStart = end;
  };

  while (i < sql.length) {
    const ch = sql[i];

    // Block comment
    if (ch === '/' && sql[i + 1] === '*') {
      flushCode(i);
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      push('comment', i, end);
      i = end;
      continue;
    }

    // Line comment
    const marker = lineComments.find((m) => sql.startsWith(m, i));
    if (marker) {
      flushCode(i);
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      push('comment', i, end);
      i = end;
      continue;
    }

    // String literal. In MySQL, Hive, Spark and BigQuery a double-quoted run is a
    // string too; reading it as code let an apostrophe inside `"O'Brien"` open a
    // string that swallowed the rest of the query.
    const quote = ch === "'" || (ch === '"' && dialect.doubleQuoteIsString) ? ch : null;
    if (quote) {
      flushCode(i);
      let j = i + 1;
      while (j < sql.length) {
        if (dialect.backslashIsEscape && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      push('string', i, Math.min(j, sql.length));
      i = j;
      continue;
    }

    // Quoted identifier
    if (ch === identOpen) {
      flushCode(i);
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === identClose) {
          // A doubled closing delimiter is an escaped one, except for [ ] where the
          // open and close differ and doubling only applies to the closer.
          if (sql[j + 1] === identClose) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      push('identifier', i, Math.min(j, sql.length));
      i = j;
      continue;
    }

    i++;
  }

  flushCode(sql.length);
  return segments;
}

/** True when the character at `index` sits inside a string, comment or quoted identifier. */
export function isInLiteral(segments: Segment[], index: number): boolean {
  for (const seg of segments) {
    if (index < seg.start) return false;
    if (index < seg.end) return seg.kind !== 'code';
  }
  return false;
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/**
 * Replace whole-token occurrences of `token` in code positions only.
 *
 * Two things a naive `String.replaceAll` gets wrong, both of which corrupt queries:
 * it rewrites `customer_segment` inside `customer_segment_range`,
 * and it rewrites the column name where it appears inside a string literal or comment.
 */
export function replaceToken(
  sql: string,
  token: string,
  replacement: string,
  dialect: Dialect,
): string {
  if (token === '') return sql;
  const segments = scan(sql, dialect);
  let out = '';

  for (const seg of segments) {
    if (seg.kind !== 'code') {
      out += seg.text;
      continue;
    }
    let text = seg.text;
    let result = '';
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) {
        result += text.slice(from);
        break;
      }
      const before = at === 0 ? '' : text[at - 1];
      const after = text[at + token.length] ?? '';
      const wholeToken = !IDENT_CHAR.test(before ?? '') && !IDENT_CHAR.test(after);
      result += text.slice(from, at) + (wholeToken ? replacement : token);
      from = at + token.length;
    }
    out += result;
  }

  return out;
}

/** Count whole-token occurrences in code positions. */
export function countToken(sql: string, token: string, dialect: Dialect): number {
  if (token === '') return 0;
  let count = 0;
  for (const seg of scan(sql, dialect)) {
    if (seg.kind !== 'code') continue;
    const text = seg.text;
    let from = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      const before = at === 0 ? '' : text[at - 1];
      const after = text[at + token.length] ?? '';
      if (!IDENT_CHAR.test(before ?? '') && !IDENT_CHAR.test(after)) count++;
      from = at + token.length;
    }
  }
  return count;
}

/** What a quoted name becomes in `splitStatements`: a plain word no keyword can match. */
export const IDENTIFIER_STANDIN = '__id__';

/**
 * The code of each `;`-separated statement, with every string reduced to `''`, every
 * quoted name to `__id__` and every comment to a space.
 *
 * Checking is done per statement rather than over the whole input, because "does a
 * WHERE exist anywhere in this text" is the wrong question for a multi-statement
 * paste: a harmless `SELECT ... WHERE ...` earlier in the block must not hide a real
 * `DELETE FROM t` with no WHERE later in the same text. A semicolon inside a string or
 * comment is naturally not a split point, since only code segments are scanned here.
 */
export function splitStatements(sql: string, dialect: Dialect): string[] {
  const statements: string[] = [];
  let current = '';

  for (const segment of scan(sql, dialect)) {
    // Contents are hidden but the shape is kept: a string is still a value and a
    // quoted name is still a name. Dropping them outright turned
    // `date("created_at")` into `date()` and `x = 'a'` into `x = `, and the checks
    // reading the result could no longer tell a column from a constant.
    if (segment.kind === 'string') {
      current += "''";
      continue;
    }
    if (segment.kind === 'identifier') {
      current += IDENTIFIER_STANDIN;
      continue;
    }
    if (segment.kind !== 'code') {
      current += ' ';
      continue;
    }
    let from = 0;
    for (;;) {
      const at = segment.text.indexOf(';', from);
      if (at === -1) {
        current += segment.text.slice(from);
        break;
      }
      current += segment.text.slice(from, at);
      statements.push(current);
      current = '';
      from = at + 1;
    }
  }
  if (current.trim() !== '') statements.push(current);
  return statements;
}
