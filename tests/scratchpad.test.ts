import { describe, it, expect } from 'vitest';
import {
  arrowConverter,
  completionSchema,
  defaultCompletionTable,
  csvHeaderWarning,
  csvSniffWarning,
  fileKind,
  formatCell,
  humanSize,
  loadSql,
  readerFor,
  formatDate,
  formatTimestamp,
  scaleDecimal,
  shapeResult,
  tableNameFor,
  stripTrailingSemicolon,
  toCsv,
  toTsv,
  ambiguousDateFormat,
  swappedDateFormat,
  decimalCommaColumns,
  describeCsvFailure,
  isReadOnlyQuery,
  readTextShapes,
  referencedTable,
  textDisplayColumns,
  textDisplaySql,
  textShapeSql,
  thousandsColumns,
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

describe('arrow value conversion', () => {
  it('puts the decimal point back', () => {
    // Arrow hands back the unscaled integer, so 1.005 arrives as 1005.
    expect(scaleDecimal('1005', 3)).toBe('1.005');
    expect(scaleDecimal('-1005', 3)).toBe('-1.005');
  });

  it('pads a value smaller than its scale', () => {
    expect(scaleDecimal('5', 3)).toBe('0.005');
    expect(scaleDecimal('-5', 2)).toBe('-0.05');
  });

  it('leaves a scale of zero alone', () => {
    expect(scaleDecimal('1005', 0)).toBe('1005');
  });

  it('renders epoch milliseconds as a date and a timestamp', () => {
    expect(formatDate(1769817600000)).toBe('2026-01-31');
    expect(formatTimestamp(1769862896000)).toBe('2026-01-31 12:34:56');
  });

  it('keeps a non-zero millisecond part', () => {
    expect(formatTimestamp(1769862896123)).toBe('2026-01-31 12:34:56.123');
  });

  it('builds a converter from the column type', () => {
    const dec = arrowConverter({ typeId: 7, scale: 3 })!;
    expect(dec('1005')).toBe('1.005');
    expect(arrowConverter({ typeId: 8 })!(1769817600000)).toBe('2026-01-31');
    expect(arrowConverter({ typeId: 10 })!(1769862896000)).toBe('2026-01-31 12:34:56');
  });

  it('leaves types that need no adjusting alone', () => {
    expect(arrowConverter({ typeId: 2 })).toBeNull();
    expect(arrowConverter(undefined)).toBeNull();
    expect(arrowConverter({ typeId: 7 })).toBeNull();
  });

  it('passes null straight through rather than converting it', () => {
    expect(arrowConverter({ typeId: 7, scale: 2 })!(null)).toBeNull();
    expect(arrowConverter({ typeId: 8 })!(null)).toBeNull();
  });
});

describe('clipboard payload', () => {
  it('writes a header row and tab-separated cells', () => {
    expect(toTsv(['a', 'b'], [[1, 'two'], [3, 'four']])).toBe('a\tb\n1\ttwo\n3\tfour');
  });

  it('keeps NULL distinguishable from an empty string and from the text NULL', () => {
    expect(toTsv(['a', 'b', 'c'], [[null, '', 'NULL']])).toBe('a\tb\tc\n\\N\t\tNULL');
  });

  it('escapes a tab inside a value rather than splitting the column', () => {
    // Pasted raw into a spreadsheet, a literal tab here would become a new column.
    expect(toTsv(['a'], [['x\ty']])).toBe('a\nx\\ty');
  });

  it('escapes a newline inside a value rather than splitting the row', () => {
    expect(toTsv(['a'], [['x\ny']])).toBe('a\nx\\ny');
  });

  it('escapes a backslash so the escaping stays reversible', () => {
    expect(toTsv(['a'], [['C:\\tmp']])).toBe('a\nC:\\\\tmp');
  });

  it('handles a result with no rows', () => {
    expect(toTsv(['a', 'b'], [])).toBe('a\tb');
  });
});

describe('completion schema', () => {
  const tables = [
    { table: 'orders', columns: ['account', 'zip', 'total'] },
    { table: 'people', columns: ['name', 'age'] },
  ];

  it('maps each loaded table to its columns', () => {
    expect(completionSchema(tables)).toEqual({
      orders: ['account', 'zip', 'total'],
      people: ['name', 'age'],
    });
  });

  it('offers nothing when nothing is loaded', () => {
    expect(completionSchema([])).toEqual({});
  });

  it('copies the column arrays rather than aliasing them', () => {
    // The caller holds these in React state; the editor must not be able to mutate them.
    const source = [{ table: 't', columns: ['a'] }];
    const schema = completionSchema(source);
    schema.t.push('injected');
    expect(source[0].columns).toEqual(['a']);
  });

  it('completes unprefixed columns only when one table is loaded', () => {
    expect(defaultCompletionTable([tables[0]])).toBe('orders');
  });

  it('refuses to pick a default when several tables are loaded', () => {
    // A bare column name belongs to no particular table; guessing puts the wrong
    // table's columns within one keystroke of being accepted.
    expect(defaultCompletionTable(tables)).toBeUndefined();
    expect(defaultCompletionTable([])).toBeUndefined();
  });
});

describe('csv export', () => {
  it('writes a header row and comma-separated cells, CRLF terminated', () => {
    expect(toCsv(['a', 'b'], [[1, 'two']])).toBe('a,b\n1,two');
  });

  it('quotes a value containing a comma rather than letting it become two columns', () => {
    expect(toCsv(['a'], [['Acme, Inc.']])).toBe('a\n"Acme, Inc."');
  });

  it('doubles an embedded quote', () => {
    expect(toCsv(['a'], [['say "hi"']])).toBe('a\n"say ""hi"""');
  });

  it('quotes a value containing a newline rather than letting it become two rows', () => {
    expect(toCsv(['a'], [['one\ntwo']])).toBe('a\n"one\ntwo"');
  });

  it('keeps null and the empty string apart', () => {
    // CSV has no NULL. An unquoted empty field is null; a quoted one is the empty
    // string — the same convention PostgreSQL's own CSV export uses.
    expect(toCsv(['a', 'b'], [[null, '']])).toBe('a,b\n,""');
  });

  it('does not turn a leading-zero value into a number', () => {
    expect(toCsv(['zip'], [['007']])).toBe('zip\n007');
  });

  it('quotes a column name that needs it', () => {
    expect(toCsv(['a,b'], [])).toBe('"a,b"');
  });

  it('handles a result with no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });
});

describe('statement tidying for export', () => {
  it('drops a trailing semicolon so COPY can wrap the statement', () => {
    expect(stripTrailingSemicolon('SELECT 1;')).toBe('SELECT 1');
    expect(stripTrailingSemicolon('SELECT 1;  \n ')).toBe('SELECT 1');
  });

  it('leaves a statement without one alone', () => {
    expect(stripTrailingSemicolon('SELECT 1')).toBe('SELECT 1');
  });

  it('does not touch a semicolon inside the statement', () => {
    expect(stripTrailingSemicolon("SELECT ';' AS c")).toBe("SELECT ';' AS c");
  });
});

describe('reading a real CSV', () => {
  const failure =
    'Conversion Error: CSV Error on Line: 30002 Original Line: 30000,N/A Error when converting column "amount". Could not convert string "N/A" to \'BIGINT\'';

  it('names the row, value and column that broke a load', () => {
    expect(describeCsvFailure(failure)).toBe(
      'line 30,002 has "N/A" in amount, which does not fit the BIGINT guessed from the rows above it',
    );
    expect(describeCsvFailure('Something else went wrong')).toBeNull();
  });

  it('passes reader options through', () => {
    expect(loadSql('t', 'a.csv', 'csv', ['sample_size=-1'])).toBe(
      `CREATE OR REPLACE TABLE "t" AS SELECT * FROM read_csv_auto('a.csv', sample_size=-1)`,
    );
  });

  it('says which way round an ambiguous date was read', () => {
    expect(ambiguousDateFormat('%m/%d/%Y')).toContain('month first');
    expect(ambiguousDateFormat('%d.%m.%Y')).toContain('day first');
    expect(ambiguousDateFormat('%Y-%m-%d')).toBeNull();
    expect(ambiguousDateFormat(null)).toBeNull();
    expect(swappedDateFormat('%m/%d/%Y')).toBe('%d/%m/%Y');
  });

  it('spots numbers written with a decimal comma or thousands separators', () => {
    const shapes = readTextShapes(['eu', 'us', 'name'], [2, 2, 0, 0, 3, 0, 2, 1, 3, 0, 0, 0]);
    expect(decimalCommaColumns(shapes)).toEqual(['eu']);
    expect(thousandsColumns(shapes)).toEqual(['us']);
  });

  it('counts every shape in one query over a sample', () => {
    const sql = textShapeSql('t', ['Lifetime Value']);
    expect(sql).toContain('count("Lifetime Value") AS n0');
    expect(sql).toContain('LIMIT 10000');
  });
});

describe('showing values faithfully', () => {
  it('sends time, interval, timestamps and nested values through DuckDB text', () => {
    expect(
      textDisplayColumns([
        ['a', 'INTEGER'],
        ['b', 'TIMESTAMP'],
        ['c', 'TIME'],
        ['d', 'INTERVAL'],
        ['e', 'DECIMAL(10,2)[]'],
        ['f', 'STRUCT(d DATE, amt DECIMAL(10,3))'],
        ['g', 'MAP(VARCHAR, INTEGER)'],
        ['h', 'DATE'],
        ['i', 'TIMESTAMP WITH TIME ZONE'],
      ]),
    ).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'i']);
  });

  it('leaves a result with duplicate column names alone', () => {
    expect(textDisplayColumns([['id', 'TIMESTAMP'], ['id', 'TIMESTAMP']])).toEqual([]);
  });

  it('wraps only read-only statements', () => {
    expect(isReadOnlyQuery('SELECT 1')).toBe(true);
    expect(isReadOnlyQuery('  with x as (select 1) select * from x')).toBe(true);
    expect(isReadOnlyQuery('FROM t')).toBe(true);
    expect(isReadOnlyQuery('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isReadOnlyQuery('CREATE TABLE t AS SELECT 1')).toBe(false);
  });

  it('casts the named columns and nothing else', () => {
    expect(textDisplaySql('SELECT ts, n FROM t;', ['ts'])).toBe(
      'SELECT * REPLACE (CAST("ts" AS VARCHAR) AS "ts") FROM (SELECT ts, n FROM t) AS sqlparity_display',
    );
  });
});

describe('suggesting bare column names with several tables loaded', () => {
  const tables = [
    { table: 'orders', columns: ['id'] },
    { table: 'customers', columns: ['name'] },
  ];

  it('uses the loaded table the query reads', () => {
    expect(referencedTable('SELECT  FROM customers WHERE ', tables)).toBe('customers');
    expect(referencedTable('SELECT * FROM "orders"', tables)).toBe('orders');
    expect(referencedTable('SELECT 1', tables)).toBeUndefined();
  });
});
