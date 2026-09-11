import type { Dialect } from './dialects';
import { scan } from './tokenize';

/**
 * Syntax colouring for display, built on the same scanner the tools use.
 *
 * Deliberately not a second parser. lib/tokenize.ts already knows where strings,
 * comments and quoted identifiers begin and end for every dialect — including the
 * dialect-specific rules about doubled quotes and backslash escapes — so colouring
 * only has to break the remaining code positions into words, numbers and operators.
 * Reusing it means the colours on the page cannot disagree with the transformations
 * the page is demonstrating.
 */

export type TokenKind =
  | 'keyword'
  | 'function'
  | 'string'
  | 'comment'
  | 'identifier'
  | 'number'
  | 'operator'
  | 'plain';

export interface HighlightToken {
  text: string;
  kind: TokenKind;
}

/**
 * Reserved words worth colouring — the ones that carry query structure. This is not
 * a complete reserved-word list for any dialect, and does not need to be: an unlisted
 * word simply renders as an identifier, which is a harmless outcome for display.
 */
const KEYWORDS = new Set([
  'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE', 'CAST',
  'COLUMN', 'CREATE', 'CROSS', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'END',
  'EXCEPT', 'EXISTS', 'EXTERNAL', 'FETCH', 'FIRST', 'FROM', 'FULL', 'GROUP', 'HAVING',
  'IF', 'IN', 'INNER', 'INSERT', 'INTERSECT', 'INTO', 'IS', 'JOIN', 'LEFT', 'LIKE',
  'LIMIT', 'NATURAL', 'NEXT', 'NOT', 'NULL', 'NULLS', 'OFFSET', 'ON', 'ONLY', 'OR',
  'ORDER', 'OUTER', 'OVER', 'PARTITION', 'QUALIFY', 'RIGHT', 'ROWS', 'SELECT', 'SET',
  'TABLE', 'THEN', 'TOP', 'TRUE', 'FALSE', 'UNION', 'UNIQUE', 'UPDATE', 'USING',
  'VALUES', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
  // Type names read as structure in a CAST, which is most of where they appear here.
  'BIGINT', 'BOOLEAN', 'DATE', 'DECIMAL', 'DOUBLE', 'FLOAT', 'INT', 'INTEGER',
  'STRING', 'TEXT', 'TIMESTAMP', 'VARCHAR',
]);

/** Words, numbers, runs of whitespace, and everything else. */
const CODE_RE = /[A-Za-z_][A-Za-z0-9_$]*|\d+(?:\.\d+)?|\s+|[^\sA-Za-z0-9_$]+/g;

function classifyCode(code: string, out: HighlightToken[]): void {
  for (const [text] of code.matchAll(CODE_RE)) {
    if (/^\s/.test(text)) {
      out.push({ text, kind: 'plain' });
    } else if (/^\d/.test(text)) {
      out.push({ text, kind: 'number' });
    } else if (/^[A-Za-z_]/.test(text)) {
      out.push({ text, kind: KEYWORDS.has(text.toUpperCase()) ? 'keyword' : 'identifier' });
    } else {
      out.push({ text, kind: 'operator' });
    }
  }
}

/** Merge neighbours of the same kind, so the rendered markup stays small. */
function coalesce(tokens: HighlightToken[]): HighlightToken[] {
  const out: HighlightToken[] = [];
  for (const token of tokens) {
    const previous = out[out.length - 1];
    if (previous && previous.kind === token.kind) previous.text += token.text;
    else out.push({ ...token });
  }
  return out;
}

export function highlightSql(sql: string, dialect: Dialect): HighlightToken[] {
  const tokens: HighlightToken[] = [];

  for (const segment of scan(sql, dialect)) {
    if (segment.kind === 'code') classifyCode(segment.text, tokens);
    else tokens.push({ text: segment.text, kind: segment.kind });
  }

  // A name directly before an opening parenthesis is being called, not referenced.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'identifier') continue;
    const next = tokens[i + 1];
    if (next?.kind === 'operator' && next.text.startsWith('(')) tokens[i].kind = 'function';
  }

  return coalesce(tokens);
}
