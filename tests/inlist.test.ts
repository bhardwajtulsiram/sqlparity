import { describe, it, expect } from 'vitest';
import { getDialect } from '../lib/dialects';
import {
  detectSeparator,
  splitValues,
  applyCleanup,
  buildInList,
  parseInList,
  DEFAULT_BUILD,
  DEFAULT_CLEANUP,
  type BuildOptions,
} from '../lib/inlist';

const trino = getDialect('athena');
const mysql = getDialect('mysql');
const oracle = getDialect('oracle');

const build = (overrides: Partial<BuildOptions> = {}): BuildOptions => ({
  ...DEFAULT_BUILD,
  dialect: trino,
  ...overrides,
});

describe('separator detection', () => {
  it('reads one value per line', () => {
    const d = detectSeparator('a\nb\nc');
    expect(d.separator).toBe('newline');
    expect(d.confident).toBe(true);
  });

  it('reads a comma-separated single line', () => {
    const d = detectSeparator('a,b,c');
    expect(d.separator).toBe('comma');
    expect(d.confident).toBe(true);
  });

  it('prefers tabs, which usually mean a spreadsheet paste', () => {
    const d = detectSeparator('a\tvarchar\nb\tbigint');
    expect(d.separator).toBe('tab');
    expect(d.confident).toBe(true);
  });

  it('is not confident when every line has commas', () => {
    const d = detectSeparator('a,b\nc,d');
    expect(d.confident).toBe(false);
    expect(d.separator).toBe('newlineAndComma');
    expect(d.alternatives).toContain('newline');
  });

  it('leans towards line-splitting when only some lines have commas', () => {
    // "Acme, Inc." is one company name, not two values.
    const d = detectSeparator('Acme, Inc.\nBeta Corp\nGamma Ltd');
    expect(d.separator).toBe('newline');
    expect(d.confident).toBe(false);
    expect(d.reason).toMatch(/may be part of the values/);
  });
});

describe('splitting', () => {
  it('splits on newlines', () => {
    expect(splitValues('a\nb\nc', 'newline')).toEqual(['a', 'b', 'c']);
  });

  it('normalises CRLF', () => {
    expect(splitValues('a\r\nb', 'newline')).toEqual(['a', 'b']);
  });

  it('keeps commas inside a quoted field', () => {
    expect(splitValues('"Acme, Inc.",Beta', 'comma')).toEqual(['Acme, Inc.', 'Beta']);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(splitValues('"He said ""hi""",next', 'comma')).toEqual(['He said "hi"', 'next']);
  });

  it('leaves a quote that does not open a field alone', () => {
    expect(splitValues('5" pipe\n6" pipe', 'newline')).toEqual(['5" pipe', '6" pipe']);
  });

  it('splits lines and commas together', () => {
    expect(splitValues('a,b\nc,d', 'newlineAndComma')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('splits a spreadsheet paste on tabs', () => {
    expect(splitValues('a\tvarchar\nb\tbigint', 'tab')).toEqual(['a', 'varchar', 'b', 'bigint']);
  });
});

describe('cleanup', () => {
  it('does nothing by default', () => {
    const r = applyCleanup([' a ', '', 'a'], DEFAULT_CLEANUP);
    expect(r.values).toEqual([' a ', '', 'a']);
    expect(r.blanksRemoved).toBe(0);
    expect(r.duplicatesRemoved).toBe(0);
  });

  it('trims and counts what changed', () => {
    const r = applyCleanup([' a ', 'b'], { ...DEFAULT_CLEANUP, trim: true });
    expect(r.values).toEqual(['a', 'b']);
    expect(r.trimmed).toBe(1);
  });

  it('drops blanks and counts them', () => {
    const r = applyCleanup(['a', '', '  ', 'b'], { ...DEFAULT_CLEANUP, dropBlank: true });
    expect(r.values).toEqual(['a', 'b']);
    expect(r.blanksRemoved).toBe(2);
  });

  it('dedupes preserving first-seen order', () => {
    const r = applyCleanup(['b', 'a', 'b', 'c', 'a'], { ...DEFAULT_CLEANUP, dedupe: true });
    expect(r.values).toEqual(['b', 'a', 'c']);
    expect(r.duplicatesRemoved).toBe(2);
  });

  it('applies case folding before deduping so casing variants collapse', () => {
    const r = applyCleanup(['A', 'a'], { ...DEFAULT_CLEANUP, dedupe: true, caseMode: 'lower' });
    expect(r.values).toEqual(['a']);
    expect(r.duplicatesRemoved).toBe(1);
  });
});

describe('building the list', () => {
  it('produces a paste-ready IN clause', () => {
    const r = buildInList(['a', 'b'], build({ wrapAt: 0 }));
    expect(r.output).toBe("IN ('a', 'b')");
  });

  it('produces a bare list', () => {
    const r = buildInList(['a', 'b'], build({ shape: 'bare', wrapAt: 0 }));
    expect(r.output).toBe("'a', 'b'");
  });

  it('produces a full WHERE clause with a quoted identifier', () => {
    const r = buildInList(['a'], build({ shape: 'where', columnName: 'customer_id', wrapAt: 0 }));
    expect(r.output).toBe(`WHERE "customer_id" IN ('a')`);
  });

  it('escapes values for the selected dialect', () => {
    const r = buildInList(["O'Brien", 'C:\\x'], build({ dialect: mysql, wrapAt: 0 }));
    expect(r.output).toBe("IN ('O''Brien', 'C:\\\\x')");
  });

  it('wraps long lists across lines', () => {
    const r = buildInList(['a', 'b', 'c', 'd'], build({ wrapAt: 2 }));
    expect(r.output).toBe("IN (\n  'a', 'b',\n  'c', 'd'\n)");
  });

  it('chunks into separate lists', () => {
    const r = buildInList(['a', 'b', 'c'], build({ chunkSize: 2, wrapAt: 0 }));
    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[0]).toBe("IN ('a', 'b')");
    expect(r.chunks[1]).toBe("IN ('c')");
  });

  it('returns nothing for an empty list', () => {
    const r = buildInList([], build());
    expect(r.output).toBe('');
    expect(r.valueCount).toBe(0);
  });
});

describe('warnings', () => {
  it('flags literal NULLs, which an IN list can never match', () => {
    const r = buildInList(['a', 'NULL'], build());
    expect(r.warnings.some((w) => /never matches NULL/.test(w.message))).toBe(true);
  });

  it('flags blank values', () => {
    const r = buildInList(['a', ''], build());
    expect(r.warnings.some((w) => /blank value/.test(w.message))).toBe(true);
  });

  it('flags a mix of numeric and non-numeric values in auto mode', () => {
    const r = buildInList(['1', 'abc'], build());
    expect(r.warnings.some((w) => /Mixed types/.test(w.message))).toBe(true);
  });

  it('does not flag mixed types when the mode is explicit', () => {
    const r = buildInList(['1', 'abc'], build({ valueMode: 'string' }));
    expect(r.warnings.some((w) => /Mixed types/.test(w.message))).toBe(false);
  });

  it('explains why leading-zero values stay quoted', () => {
    const r = buildInList(['007', '008'], build());
    expect(r.warnings.some((w) => /with a zero/.test(w.message))).toBe(true);
  });

  it('keeps subject and verb in agreement for a single value', () => {
    const one = buildInList(['007'], build({ valueMode: 'auto' }));
    expect(one.warnings.find((w) => /with a zero/.test(w.message))?.message).toMatch(
      /^1 value starts with a zero/,
    );
    const many = buildInList(['007', '008'], build({ valueMode: 'auto' }));
    expect(many.warnings.find((w) => /with a zero/.test(w.message))?.message).toMatch(
      /^2 values start with a zero/,
    );
  });

  it("flags Oracle's 1000-value ceiling", () => {
    const values = Array.from({ length: 1001 }, (_, i) => String(i + 1));
    const r = buildInList(values, build({ dialect: oracle }));
    expect(r.warnings.some((w) => /at most 1000 values/.test(w.message))).toBe(true);
  });

  it('stops flagging the ceiling once chunking is on', () => {
    const values = Array.from({ length: 1001 }, (_, i) => String(i + 1));
    const r = buildInList(values, build({ dialect: oracle, chunkSize: 1000 }));
    expect(r.warnings.some((w) => /at most 1000 values/.test(w.message))).toBe(false);
  });
});

describe('reverse mode', () => {
  it('extracts values from a full clause', () => {
    expect(parseInList("WHERE col IN ('a', 'b', 'c')", trino)).toEqual(['a', 'b', 'c']);
  });

  it('extracts values from a bare list', () => {
    expect(parseInList("'a','b'", trino)).toEqual(['a', 'b']);
  });

  it('handles unquoted numbers', () => {
    expect(parseInList('IN (1, 2, 3)', trino)).toEqual(['1', '2', '3']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseInList("IN ('O''Brien')", trino)).toEqual(["O'Brien"]);
  });

  it('unescapes backslashes only where the dialect uses them', () => {
    expect(parseInList("IN ('C:\\\\x')", mysql)).toEqual(['C:\\x']);
    expect(parseInList("IN ('C:\\x')", trino)).toEqual(['C:\\x']);
  });

  it('keeps a comma that sits inside a quoted value', () => {
    expect(parseInList("IN ('Acme, Inc.', 'Beta')", trino)).toEqual(['Acme, Inc.', 'Beta']);
  });

  it('round-trips through the builder', () => {
    const original = ["O'Brien", 'Acme, Inc.', 'plain'];
    const built = buildInList(original, build({ wrapAt: 0 }));
    expect(parseInList(built.output, trino)).toEqual(original);
  });

  it('round-trips through the builder for MySQL backslashes', () => {
    const original = ['C:\\path', "it's"];
    const built = buildInList(original, build({ dialect: mysql, wrapAt: 0 }));
    expect(parseInList(built.output, mysql)).toEqual(original);
  });
});
