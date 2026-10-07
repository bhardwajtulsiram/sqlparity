import { describe, expect, it } from 'vitest';
import { assess, DEFAULT_OPTIONS, type ParityResult, type ParitySpec } from '../lib/parity';
import {
  escapeHtml,
  humanBytes,
  reportFilename,
  reportHtml,
  reportMarkdown,
  type ParityReport,
} from '../lib/parity-report';

const pair = (name: string, type = 'VARCHAR') => ({ source: name, target: name, sourceType: type, targetType: type });

function makeReport(overrides: Partial<ParityResult> = {}, includeSamples = false): ParityReport {
  const spec: ParitySpec = { keys: [pair('id', 'INTEGER')], compare: [pair('name')], options: DEFAULT_OPTIONS };
  const result: ParityResult = {
    mode: 'key',
    sourceRows: 3,
    targetRows: 3,
    keys: { sourceDuplicates: 0, targetDuplicates: 0, sourceNulls: 0, targetNulls: 0, matched: 3, onlySource: 0, onlyTarget: 0, comparedRows: 3 },
    columns: [{ pair: pair('name'), mismatches: 1, samples: [{ key: ['2'], source: '<script>alert(1)</script>', target: "O'Brien" }] }],
    onlySourceSamples: [],
    onlyTargetSamples: [],
    unpairedSource: [],
    unpairedTarget: [],
    excluded: [],
    queries: [{ label: 'Row counts', sql: 'SELECT count(*) FROM parity_source' }],
    engineVersion: 'v1.3.0',
    elapsedMs: 12,
    ...overrides,
  };
  return {
    title: 'Customers <to> warehouse',
    preparedBy: 'Data team',
    notes: '',
    generatedAt: new Date(Date.UTC(2026, 9, 7, 9, 5, 0)),
    appVersion: '0.1.0',
    inputs: [
      { side: 'source', name: 'customers.csv', bytes: 2048, rows: 3, columns: 2, sha256: 'a'.repeat(64), notes: [] },
      { side: 'target', name: 'customers.parquet', bytes: 1024, rows: 3, columns: 2, sha256: null, notes: ['Read with a decimal comma.'] },
    ],
    spec,
    result,
    assessment: assess(result, spec.options),
    includeSamples,
  };
}

describe('sign-off report', () => {
  it('escapes everything that came from a file or a person', () => {
    const html = reportHtml(makeReport({}, true));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Customers &lt;to&gt; warehouse');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('leaves sample values out unless asked, and says so', () => {
    const html = reportHtml(makeReport({}, false));
    expect(html).not.toContain("O&#39;Brien");
    expect(html).toContain('Sample values were left out');
    expect(reportHtml(makeReport({}, true))).toContain('O&#39;Brien');
  });

  it('identifies inputs by fingerprint and admits a missing one', () => {
    const html = reportHtml(makeReport());
    expect(html).toContain('a'.repeat(64));
    expect(html).toContain('not computed');
    expect(html).toContain('Read with a decimal comma.');
  });

  it('prints the verdict the assessment gave, with its findings', () => {
    const differs = reportHtml(makeReport());
    expect(differs).toContain('class="verdict differs"');
    expect(differs).toContain('Differences found');
    expect(differs).toContain('name: 1 matched row holds a different value.');

    const clean = reportHtml(makeReport({ columns: [{ pair: pair('name'), mismatches: 0, samples: [] }] }));
    expect(clean).toContain('class="verdict match"');

    const partial = reportHtml(
      makeReport({ columns: [{ pair: pair('name'), mismatches: 0, samples: [] }], unpairedTarget: ['loaded_at'] }),
    );
    expect(partial).toContain('Match on compared columns');
    expect(partial).toContain('only in the target: loaded_at');
  });

  it('includes every statement and a machine-readable block that cannot close its script tag', () => {
    const html = reportHtml(makeReport({ queries: [{ label: 'Row counts', sql: "SELECT '</script>'" }] }));
    expect(html).toContain('SELECT &#39;&lt;/script&gt;&#39;');
    const block = html.slice(html.indexOf('id="sqlparity-run">'));
    expect(block.indexOf('</script>')).toBe(block.lastIndexOf('</script>'));
    const json = JSON.parse(block.slice(block.indexOf('>') + 1, block.indexOf('</script>')));
    expect(json.inputs[0].sha256).toBe('a'.repeat(64));
    expect(json.verdict).toBe('differs');
  });

  it('names the file after the title and the time, and writes a Markdown summary', () => {
    expect(reportFilename(makeReport())).toBe('customers-to-warehouse-202610070905.html');
    const md = reportMarkdown(makeReport());
    expect(md).toContain('Differences found');
    expect(md).toContain('`customers.csv`');
    expect(md).toContain('- name: 1 matched row holds a different value.');
  });

  it('formats sizes for people', () => {
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2.0 KB');
    expect(humanBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
