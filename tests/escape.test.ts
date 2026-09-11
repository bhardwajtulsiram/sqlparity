import { describe, it, expect } from 'vitest';
import { getDialect, DIALECTS } from '../lib/dialects';
import {
  escapeStringBody,
  quoteString,
  quoteIdentifier,
  isNumericLiteral,
  hasSignificantLeadingZero,
  isNullLiteral,
  renderValue,
} from '../lib/escape';

const trino = getDialect('athena');
const mysql = getDialect('mysql');
const postgres = getDialect('postgresql');
const bigquery = getDialect('bigquery');
const tsql = getDialect('mssql');

describe('single-quote escaping', () => {
  it("doubles quotes in standard dialects", () => {
    expect(quoteString("O'Brien", trino)).toBe("'O''Brien'");
    expect(quoteString("O'Brien", postgres)).toBe("'O''Brien'");
    expect(quoteString("O'Brien", mysql)).toBe("'O''Brien'");
  });

  it('backslash-escapes quotes only where doubling is unsupported', () => {
    expect(quoteString("O'Brien", bigquery)).toBe("'O\\'Brien'");
  });

  it('handles several quotes in one value', () => {
    expect(quoteString("it's o'clock", trino)).toBe("'it''s o''clock'");
  });

  it('handles a value that is only a quote', () => {
    expect(quoteString("'", trino)).toBe("''''");
  });
});

describe('backslash handling', () => {
  it('leaves backslashes alone in standard-conforming dialects', () => {
    expect(quoteString('C:\\path\\file', trino)).toBe("'C:\\path\\file'");
    expect(quoteString('C:\\path\\file', postgres)).toBe("'C:\\path\\file'");
    expect(quoteString('C:\\path\\file', tsql)).toBe("'C:\\path\\file'");
  });

  it('doubles backslashes where they are escape characters', () => {
    expect(quoteString('C:\\path\\file', mysql)).toBe("'C:\\\\path\\\\file'");
    expect(quoteString('C:\\path\\file', bigquery)).toBe("'C:\\\\path\\\\file'");
  });

  it('does not let \\n become a newline in MySQL', () => {
    // Left unescaped, MySQL would read this as a line feed rather than the two
    // characters the user actually pasted.
    expect(escapeStringBody('a\\nb', mysql)).toBe('a\\\\nb');
  });
});

describe('escape ordering', () => {
  // Backslashes must be doubled before quotes are escaped. Doing it the other way
  // round in a backslash-escaping dialect turns \' into \\' — a literal backslash
  // followed by a string terminator.
  it('produces valid output when a value has both a quote and a backslash', () => {
    expect(quoteString("O'Brien\\x", bigquery)).toBe("'O\\'Brien\\\\x'");
    expect(quoteString("O'Brien\\x", mysql)).toBe("'O''Brien\\\\x'");
  });

  it('never leaves an odd number of backslashes before the closing quote', () => {
    for (const dialect of DIALECTS) {
      const body = escapeStringBody('ends with backslash\\', dialect);
      const trailing = body.match(/\\*$/)?.[0].length ?? 0;
      if (dialect.backslashIsEscape) {
        expect(trailing % 2, `${dialect.id} left an unpaired trailing backslash`).toBe(0);
      }
    }
  });
});

describe('identifier quoting', () => {
  it('uses the right delimiters per dialect', () => {
    expect(quoteIdentifier('my_col', postgres)).toBe('"my_col"');
    expect(quoteIdentifier('my_col', mysql)).toBe('`my_col`');
    expect(quoteIdentifier('my_col', tsql)).toBe('[my_col]');
  });

  it('escapes the closing delimiter inside an identifier', () => {
    expect(quoteIdentifier('we"ird', postgres)).toBe('"we""ird"');
    expect(quoteIdentifier('we`ird', mysql)).toBe('`we``ird`');
    expect(quoteIdentifier('we]ird', tsql)).toBe('[we]]ird]');
  });
});

describe('numeric detection', () => {
  it('accepts plain numbers', () => {
    for (const v of ['0', '7', '123', '-3', '+3', '1.5', '.5', '1e5', '2E-3', '-0.25']) {
      expect(isNumericLiteral(v), `${v} should be numeric`).toBe(true);
    }
  });

  it('rejects values that are not numbers', () => {
    for (const v of ['', ' ', 'abc', '1,000', '1 2', '12px', 'NaN', '0x1F', '1.2.3', '--1']) {
      expect(isNumericLiteral(v), `${v} should not be numeric`).toBe(false);
    }
  });

  it('treats leading-zero values as strings so the zeros survive', () => {
    // "007" emitted unquoted becomes 7 and matches the wrong rows.
    expect(isNumericLiteral('007')).toBe(false);
    expect(isNumericLiteral('0123')).toBe(false);
    expect(hasSignificantLeadingZero('007')).toBe(true);
    expect(hasSignificantLeadingZero('0')).toBe(false);
    expect(hasSignificantLeadingZero('0.5')).toBe(false);
  });

  it('ignores surrounding whitespace', () => {
    expect(isNumericLiteral('  42  ')).toBe(true);
  });
});

describe('NULL detection', () => {
  it('matches the bare token in any casing', () => {
    expect(isNullLiteral('NULL')).toBe(true);
    expect(isNullLiteral('null')).toBe(true);
    expect(isNullLiteral('  Null ')).toBe(true);
  });

  it('does not match values that merely contain it', () => {
    expect(isNullLiteral('NULLABLE')).toBe(false);
    expect(isNullLiteral("'NULL'")).toBe(false);
  });
});

describe('renderValue', () => {
  it('quotes everything in string mode, including numbers', () => {
    expect(renderValue('42', trino, 'string')).toBe("'42'");
  });

  it('leaves unambiguous numbers unquoted in auto mode', () => {
    expect(renderValue('42', trino, 'auto')).toBe('42');
    expect(renderValue('  42 ', trino, 'auto')).toBe('42');
  });

  it('falls back to a quoted string rather than emitting invalid SQL', () => {
    expect(renderValue('abc', trino, 'numeric')).toBe("'abc'");
  });
});

describe('dialect registry', () => {
  it('resolves aliases', () => {
    expect(getDialect('athena').id).toBe('trino');
    expect(getDialect('ATHENA').id).toBe('trino');
    expect(getDialect('postgres').id).toBe('postgresql');
    expect(getDialect('sqlserver').id).toBe('transactsql');
  });

  it('throws on an unknown dialect', () => {
    expect(() => getDialect('nosuchdb')).toThrow(/Unknown SQL dialect/);
  });

  it('gives Oracle its IN-list ceiling', () => {
    expect(getDialect('oracle').maxInListSize).toBe(1000);
    expect(getDialect('athena').maxInListSize).toBeUndefined();
  });

  it('uses the documented null-safe comparison per dialect', () => {
    expect(getDialect('athena').nullSafeNotEqual?.('a.x', 'b.x')).toBe('a.x IS DISTINCT FROM b.x');
    expect(getDialect('mysql').nullSafeNotEqual?.('a.x', 'b.x')).toBe('NOT (a.x <=> b.x)');
  });
});

describe('the registry itself', () => {
  it('holds sixteen dialects with no gaps or duplicates', () => {
    // A reorder once left holes in the array literal, which типechecks as undefined
    // and only shows up as a crash at runtime.
    expect(DIALECTS).toHaveLength(16);
    expect(DIALECTS.every(Boolean)).toBe(true);
    expect(new Set(DIALECTS.map((d) => d.id)).size).toBe(16);
  });

  it('is ordered by how widely used each dialect is, not by this project’s own dialect', () => {
    // Every picker and listing in the app maps this array, so the order is a product
    // decision rather than an implementation detail. Athena is what the tool was built
    // around; leading with it would read as a niche tool.
    expect(DIALECTS.slice(0, 3).map((d) => d.id)).toEqual(['postgresql', 'mysql', 'sqlite']);
    expect(DIALECTS[0]!.id).not.toBe('trino');
    expect(DIALECTS.at(-1)!.id).toBe('sql');
  });
});
