import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { collectOutputs, convertFile, fitCell, formatFile, type BatchResult } from '../lib/batch';
import { getDialect } from '../lib/dialects';
import { DEFAULT_FORMAT } from '../lib/format';
import { detectDelimiter, isSqlCell, parseCsv, readCsv, readSheet, readXlsx } from '../lib/sheets';

const pg = getDialect('postgresql');
/** Decode keeping a byte-order mark, so a test can see whether one was written. */
const raw = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
/** Written by openpyxl, as a real workbook would be: see the fixture's sheets in the tests below. */
const fixture = new Uint8Array(readFileSync(new URL('./fixtures/queries.xlsx', import.meta.url)));

describe('spotting SQL in a cell', () => {
  it.each([
    'select id from users',
    'SELECT 1',
    'SELECT TOP 10 * FROM orders',
    '-- monthly\nSELECT region FROM sales',
    '/* report */ with t as (select 1) select * from t',
    'INSERT INTO t (a) VALUES (1)',
    'update orders set status = 2 where id = 1',
    'delete from logs where day < now()',
    'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE',
    'CREATE OR REPLACE VIEW v AS SELECT 1',
    'create table if not exists t (id int)',
    'DROP TABLE staging.orders',
    'truncate table t',
    'EXEC sp_who2',
    'call refresh_stats(1)',
    'DECLARE @d date = getdate()',
    "select 'the end' as label from dual",
  ])('reads %j as SQL', (text) => expect(isSqlCell(text)).toBe(true));

  it.each([
    'Select the rows from the table below',
    'Update the figures monthly',
    'Delete when you are done',
    'Create a table of results',
    'With thanks to the data team',
    'Execute the plan by Friday',
    'selection',
    'Selected',
    '42',
    '',
  ])('leaves %j alone', (text) => expect(isSqlCell(text)).toBe(false));
});

describe('CSV', () => {
  it('finds the delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a,b\n', 'x.tsv')).toBe('\t');
  });

  it('parses quoted fields, doubled quotes and line breaks, with offsets', () => {
    const text = 'a,"b ""x""",c\r\n"multi\nline",,z';
    const fields = parseCsv(text, ',');
    expect(fields.map((f) => [f.row, f.col, f.value])).toEqual([
      [0, 0, 'a'],
      [0, 1, 'b "x"'],
      [0, 2, 'c'],
      [1, 0, 'multi\nline'],
      [1, 1, ''],
      [1, 2, 'z'],
    ]);
    expect(text.slice(fields[1]!.start, fields[1]!.end)).toBe('"b ""x"""');
  });

  it('rewrites only the SQL cells, keeping every other byte', () => {
    const text = '﻿name;query;note\r\nusers;"select id from users where a = 1";"keep ""this"" exactly"\r\nplain;Select the region below;x\r\n';
    const doc = readCsv(strToU8(text), 'q.csv');
    expect(doc.cells).toEqual([{ ref: 'B2', label: 'B2 (query)', text: 'select id from users where a = 1' }]);
    const out = raw(doc.write(new Map([['B2', 'SELECT\n  id\nFROM users']])));
    expect(out).toBe('﻿name;query;note\r\nusers;"SELECT\n  id\nFROM users";"keep ""this"" exactly"\r\nplain;Select the region below;x\r\n');
  });

  it('reads a file that is not UTF-8 and writes it back as UTF-8 Excel can open', () => {
    const bytes = new Uint8Array([...strToU8('q\n"select nom from t where x = \'caf'), 0xe9, ...strToU8('\'"\n')]);
    const doc = readCsv(bytes, 'legacy.csv');
    expect(doc.cells[0]!.text).toBe("select nom from t where x = 'café'");
    const out = raw(doc.write(new Map([['A2', "SELECT nom FROM t WHERE x = 'café'"]])));
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toContain('café');
  });
});

describe('Excel', () => {
  const doc = readXlsx(fixture);

  it('finds the SQL cells on every sheet, named by sheet, cell and header', () => {
    expect(doc.cells.map((c) => c.label)).toEqual(['Reports!B2 (query)', 'Reports!B3 (query)', 'Reports!B5 (query)', 'Ad hoc!A1']);
    expect(doc.cells[2]!.text).toBe("select 'naïve ☕' as label from dual");
  });

  it('skips prose, numbers and formulas', () => {
    const labels = doc.cells.map((c) => c.ref);
    expect(labels).not.toContain('Reports!C2');
    expect(labels).not.toContain('Reports!B4');
    expect(labels).not.toContain('Reports!C4');
  });

  it('writes back a workbook with only the changed cells replaced', () => {
    const out = doc.write(new Map([['Reports!B2', 'SELECT\n  id\nFROM users & <more>']]));
    const before = unzipSync(fixture);
    const after = unzipSync(out);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) {
      if (name !== 'xl/worksheets/sheet1.xml') expect(after[name], name).toEqual(before[name]);
    }
    const sheet = strFromU8(after['xl/worksheets/sheet1.xml']!);
    expect(sheet).toMatch(/<c r="B2" s="\d+" t="inlineStr"><is><t xml:space="preserve">SELECT\n {2}id\nFROM users &amp; &lt;more&gt;<\/t><\/is><\/c>/);
    // The written workbook reads back the same way.
    const again = readXlsx(out);
    expect(again.cells.find((c) => c.ref === 'Reports!B2')?.text).toBe('SELECT\n  id\nFROM users & <more>');
  });

  it('reads prefixed XML and inline strings, as some writers produce', () => {
    const x = (s: string) => strToU8(s);
    const book = zipSync({
      'xl/workbook.xml': x('<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Q &amp; A" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'),
      'xl/_rels/workbook.xml.rels': x('<Relationships><Relationship Id="rId1" Type="worksheet" Target="/xl/worksheets/s.xml"/></Relationships>'),
      'xl/worksheets/s.xml': x(
        '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:r><x:t>select a </x:t></x:r><x:r><x:t>from b_x000D_</x:t></x:r></x:is></x:c></x:row></x:sheetData></x:worksheet>',
      ),
    });
    const d = readSheet(book, 'odd.xlsx');
    expect(d.cells).toEqual([{ ref: 'Q & A!A1', label: 'Q & A!A1', text: 'select a from b\r'.replace(/\r/g, '\n') }]);
    const written = strFromU8(unzipSync(d.write(new Map([['Q & A!A1', 'SELECT a FROM b']])))['xl/worksheets/s.xml']!);
    expect(written).toContain('<x:c r="A1" t="inlineStr"><x:is><x:t xml:space="preserve">SELECT a FROM b</x:t></x:is></x:c>');
  });

  it('says plainly when a file is not a workbook', () => {
    expect(() => readXlsx(strToU8('not a zip'))).toThrow(/not a readable Excel workbook/);
  });
});

describe('spreadsheets in a batch', () => {
  const doc = readXlsx(fixture);
  const sheets = new Map([['reports/queries.xlsx', doc]]);
  const asResults = (fn: (text: string) => BatchResult) =>
    doc.cells.map((c) => ({ ...fn(c.text), path: `reports/queries.xlsx › ${c.label}`, origin: { container: 'reports/queries.xlsx', ref: c.ref } }));

  it('gives back one workbook for all its queries, alongside plain files', () => {
    const formatted = asResults((text) => formatFile({ path: 'x', text }, pg, DEFAULT_FORMAT));
    const plain = formatFile({ path: 'a.sql', text: 'select 1' }, pg, DEFAULT_FORMAT);
    const outputs = collectOutputs([plain, ...formatted], sheets);
    expect(outputs.map((o) => [o.path, o.changed])).toEqual([
      ['a.sql', true],
      ['reports/queries.xlsx', true],
    ]);
    const cell = readXlsx(outputs[1]!.data as Uint8Array).cells.find((c) => c.ref === 'Reports!B2')!;
    expect(cell.text).toMatch(/^SELECT\n/);
    expect(cell.text.endsWith('\n')).toBe(false);
  });

  it('returns an untouched workbook exactly as it was read, or leaves it out', () => {
    const same = doc.cells.map((c) => ({ path: c.label, status: 'unchanged' as const, input: c.text, output: c.text, issues: [], origin: { container: 'reports/queries.xlsx', ref: c.ref } }));
    expect(collectOutputs(same, sheets)[0]!.data).toBe(doc.bytes);
    expect(collectOutputs(same, sheets, true)).toEqual([]);
  });

  it('converts the queries in a workbook', () => {
    const converted = asResults((text) => convertFile({ path: 'x', text: text.replace('select', 'SELECT TOP 5') }, getDialect('transactsql'), pg));
    const out = collectOutputs(converted, sheets)[0]!;
    expect(readXlsx(out.data as Uint8Array).cells[0]!.text).toMatch(/LIMIT 5/i);
  });

  it('leaves a cell alone when the result would not fit in it', () => {
    const big: BatchResult = { path: 'c', status: 'changed', input: 'select 1', output: 'x'.repeat(40_000), issues: [] };
    const fitted = fitCell(big, 'xlsx');
    expect(fitted.output).toBe('select 1');
    expect(fitted.issues[0]!.title).toMatch(/longer than an Excel cell/);
    expect(fitCell(big, 'csv')).toBe(big);
  });
});
