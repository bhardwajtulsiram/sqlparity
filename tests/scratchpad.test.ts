import { describe, it, expect } from 'vitest';
import {
  csvHeaderWarning,
  csvSniffWarning,
  fileKind,
  formatCell,
  humanSize,
  loadSql,
  readerFor,
  shapeResult,
  tableNameFor,
} from '../lib/scratchpad';

describe('file kinds', () => {
  it('recognises the formats DuckDB can read', () => {
    expect(fileKind('orders.csv')).toBe('csv');
    expect(fileKind('orders.tsv')).toBe('csv');
    expect(fileKind('orders.parquet')).toBe('parquet');
    expect(fileKind('orders.json')).toBe('json');
    expect(fileKind('orders.ndjson')).toBe('json');
  });

  it('ignores case', () => {
    expect(fileKind('ORDERS.CSV')).toBe('csv');
  });

  it('sees through a compression extension', () => {
    expect(fileKind('orders.csv.gz')).toBe('csv');
    expect(fileKind('events.json.zst')).toBe('json');
  });

  it('refuses what it cannot read', () => {
    expect(fileKind('notes.xlsx')).toBe('unsupported');
    expect(fileKind('archive.zip')).toBe('unsupported');
    expect(fileKind('noextension')).toBe('unsupported');
  });
});

describe('table names', () => {
  it('uses the filename when it is already usable', () => {
    expect(tableNameFor('orders.csv')).toBe('orders');
  });

  it('makes an awkward filename typeable without quoting', () => {
    expect(tableNameFor('2026 Orders (final).csv')).toBe('t_2026_orders_final');
    expect(tableNameFor('customer-snapshot.parquet')).toBe('customer_snapshot');
  });

  it('never starts a name with a digit', () => {
    expect(tableNameFor('2026.csv')).toBe('t_2026');
    expect(/^[a-z_]/.test(tableNameFor('123.csv'))).toBe(true);
  });

  it('survives a filename with nothing usable in it', () => {
    expect(tableNameFor('!!!.csv')).toBe('t');
  });

  it('suffixes rather than silently replacing an existing table', () => {
    const taken = new Set(['orders']);
    expect(tableNameFor('orders.csv', taken)).toBe('orders_2');
    expect(tableNameFor('orders.csv', new Set(['orders', 'orders_2']))).toBe('orders_3');
  });

  it('strips a compression extension too', () => {
    expect(tableNameFor('orders.csv.gz')).toBe('orders');
  });
});

describe('load statement', () => {
  it('picks the reader for the format', () => {
    expect(readerFor('csv')).toBe('read_csv_auto');
    expect(readerFor('parquet')).toBe('read_parquet');
    expect(readerFor('json')).toBe('read_json_auto');
  });

  it('builds a statement that quotes the table name', () => {
    expect(loadSql('orders', 'orders.csv', 'csv')).toBe(
      'CREATE OR REPLACE TABLE "orders" AS SELECT * FROM read_csv_auto(\'orders.csv\')',
    );
  });

  it('escapes an apostrophe in the filename', () => {
    // Otherwise the literal ends early and the user gets an unexplainable syntax error.
    expect(loadSql('t', "o'brien.csv", 'csv')).toContain("read_csv_auto('o''brien.csv')");
  });

  it('refuses to build a statement for a format it cannot read', () => {
    expect(() => readerFor('unsupported')).toThrow();
  });
});

describe('cell rendering', () => {
  it('distinguishes null from an empty string', () => {
    expect(formatCell(null)).toBe('NULL');
    expect(formatCell(undefined)).toBe('NULL');
    expect(formatCell('')).toBe('');
  });

  it('renders a bigint without throwing', () => {
    // JSON.stringify throws on BigInt, which is how this surfaces in practice.
    expect(formatCell(9007199254740993n)).toBe('9007199254740993');
  });

  it('keeps a numeric-looking string as a string', () => {
    expect(formatCell('007')).toBe('007');
  });

  it('renders dates, booleans and numbers', () => {
    expect(formatCell(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
    expect(formatCell(false)).toBe('false');
    expect(formatCell(0)).toBe('0');
  });

  it('summarises binary rather than dumping it', () => {
    expect(formatCell(new Uint8Array([1, 2, 3]))).toBe('<3 bytes>');
  });

  it('renders a nested value, bigints included', () => {
    expect(formatCell({ a: 1n })).toBe('{"a":"1"}');
  });
});

describe('result shaping', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => [i]);

  it('passes a small result through untouched', () => {
    const shaped = shapeResult(['a'], rows(3));
    expect(shaped.rows).toHaveLength(3);
    expect(shaped.truncated).toBe(false);
    expect(shaped.totalRows).toBe(3);
  });

  it('caps what it renders but still reports the real count', () => {
    const shaped = shapeResult(['a'], rows(1200), 500);
    expect(shaped.rows).toHaveLength(500);
    expect(shaped.totalRows).toBe(1200);
    expect(shaped.truncated).toBe(true);
  });

  it('handles an empty result', () => {
    const shaped = shapeResult(['a'], []);
    expect(shaped.rows).toEqual([]);
    expect(shaped.truncated).toBe(false);
  });
});

describe('sizes', () => {
  it('reads naturally at each scale', () => {
    expect(humanSize(512)).toBe('512 B');
    expect(humanSize(2048)).toBe('2 KB');
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('csv sniffing failures', () => {
  it('flags a header that was never split', () => {
    const warning = csvSniffWarning('csv', ['account,zip,segment,total']);
    expect(warning).toContain('one column');
    expect(warning).toContain('comma');
  });

  it('names the separator it found', () => {
    expect(csvSniffWarning('csv', ['a;b;c'])).toContain('semicolon');
    expect(csvSniffWarning('csv', ['a\tb'])).toContain('tab');
  });

  it('stays quiet when the file really does have one column', () => {
    expect(csvSniffWarning('csv', ['id'])).toBeNull();
  });

  it('stays quiet when the file split properly', () => {
    expect(csvSniffWarning('csv', ['account', 'zip'])).toBeNull();
  });

  it('does not second-guess a format that carries its own schema', () => {
    // Parquet and JSON declare their columns; a single column there is just a fact.
    expect(csvSniffWarning('parquet', ['a,b'])).toBeNull();
    expect(csvSniffWarning('json', ['a,b'])).toBeNull();
  });
});

describe('csv header failures', () => {
  it('flags generic column names, which mean the header was lost', () => {
    const warning = csvHeaderWarning('csv', ['column0', 'column1', 'column2']);
    expect(warning).toContain('No header row');
    expect(warning).toContain('skipped');
  });

  it('leaves real column names alone', () => {
    expect(csvHeaderWarning('csv', ['account', 'zip'])).toBeNull();
  });

  it('does not fire when only some names are generic', () => {
    expect(csvHeaderWarning('csv', ['account', 'column1'])).toBeNull();
  });

  it('ignores formats that carry their own schema', () => {
    expect(csvHeaderWarning('parquet', ['column0', 'column1'])).toBeNull();
  });
});
