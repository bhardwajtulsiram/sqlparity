import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  convertFile,
  formatFile,
  hasOutput,
  inSkippedFolder,
  isSqlFile,
  outputName,
  relativePath,
  reviewCsv,
  reviewFile,
  reviewMarkdown,
  summarise,
  syntaxProbe,
  zipResults,
} from '../lib/batch';
import { getDialect } from '../lib/dialects';
import { DEFAULT_FORMAT } from '../lib/format';

const pg = getDialect('postgresql');

describe('picking files from a folder', () => {
  it('takes SQL files and leaves the rest', () => {
    expect(isSqlFile('models/orders.sql')).toBe(true);
    expect(isSqlFile('ddl/customers.DDL')).toBe(true);
    expect(isSqlFile('README.md')).toBe(false);
    expect(isSqlFile('dbt_project.yml')).toBe(false);
  });

  it('skips dependency and build folders, at any depth', () => {
    expect(inSkippedFolder('target/compiled/models/a.sql')).toBe(true);
    expect(inSkippedFolder('project/node_modules/x/a.sql')).toBe(true);
    expect(inSkippedFolder('models/staging/stg_orders.sql')).toBe(false);
    expect(inSkippedFolder('targets.sql')).toBe(false);
  });

  it('drops the chosen folder’s own name from the path', () => {
    expect(relativePath('analytics/models/orders.sql')).toBe('models/orders.sql');
    expect(relativePath('analytics\\models\\orders.sql')).toBe('models/orders.sql');
    expect(relativePath('orders.sql')).toBe('orders.sql');
  });
});

describe('processing files', () => {
  it('formats, and does not count a missing final newline as a change', () => {
    const changed = formatFile({ path: 'a.sql', text: 'select a,b from t where x=1' }, pg, DEFAULT_FORMAT);
    expect(changed.status).toBe('changed');
    expect(changed.output).toMatch(/^SELECT/);
    const again = formatFile({ path: 'a.sql', text: changed.output!.trimEnd() }, pg, DEFAULT_FORMAT);
    expect(again.status).toBe('unchanged');
  });

  it('formats dbt models without breaking their templates', () => {
    const r = formatFile(
      { path: 'models/m.sql', text: "select id from {{ ref('stg_orders') }} where dt > '{{ var(\"start\") }}'" },
      pg,
      DEFAULT_FORMAT,
    );
    expect(r.status).not.toBe('error');
    expect(r.output).toContain("{{ ref('stg_orders') }}");
  });

  it('converts, counting rewrites and listing what needs a person', () => {
    const r = convertFile(
      { path: 'q.sql', text: 'SELECT TOP 5 [name], CHARINDEX(\'a\', [name]) FROM [t]' },
      getDialect('transactsql'),
      pg,
    );
    expect(r.output).toContain('LIMIT 5');
    expect(r.rewrites).toBeGreaterThan(0);
    expect(r.status).toBe('issues');
    expect(r.issues[0]!.title).toMatch(/CHARINDEX/);
  });

  it('reviews with the optimizer and the safety checks', () => {
    const r = reviewFile({ path: 'r.sql', text: 'DELETE FROM orders;\nSELECT * FROM orders' }, pg);
    expect(r.status).toBe('issues');
    expect(r.issues.some((i) => i.severity === 'high')).toBe(true);
    expect(reviewFile({ path: 'ok.sql', text: 'SELECT id FROM t WHERE id = 1' }, pg).status).toBe('clean');
  });
});

describe('syntax checking dbt models', () => {
  it('stands in for {{ }} expressions and drops {# #} comments, keeping line numbers', () => {
    const probe = syntaxProbe("select id\nfrom {{ source('shop',\n'orders') }}\n{# a note #}\nwhere x = 1");
    expect(probe).toEqual({ sql: 'select id\nfrom __x__\n\n \nwhere x = 1' });
    expect((probe as { sql: string }).sql.split('\n')).toHaveLength(5);
  });

  it('skips files with control blocks rather than guess which branch runs', () => {
    expect(syntaxProbe('select 1 {% if is_incremental() %} where x > 1 {% endif %}')).toEqual({ skipped: true });
  });

  it('leaves plain SQL alone', () => {
    expect(syntaxProbe('SELECT 1')).toEqual({ sql: 'SELECT 1' });
  });
});

describe('results', () => {
  const results = [
    formatFile({ path: 'models/a.sql', text: 'select 1' }, pg, DEFAULT_FORMAT),
    formatFile({ path: 'models/sub/b.sql', text: 'SELECT\n  1' }, pg, DEFAULT_FORMAT),
  ];

  it('zips the whole folder with its layout, or only what changed', () => {
    const all = unzipSync(zipResults(results));
    expect(Object.keys(all).sort()).toEqual(['models/a.sql', 'models/sub/b.sql']);
    expect(strFromU8(all['models/a.sql']!)).toMatch(/^SELECT/);
    expect(Object.keys(unzipSync(zipResults(results, true)))).toEqual(['models/a.sql']);
  });

  it('names a download for what was done, keeping names inside the zip', () => {
    expect(outputName('report.sql', 'format')).toBe('formatted_report.sql');
    expect(outputName('models/sub/orders.sql', 'convert')).toBe('converted_orders.sql');
    expect(outputName('x.hql', 'review')).toBe('reviewed_x.hql');
    // dbt finds models by file name, so the zip must not rename them.
    expect(Object.keys(unzipSync(zipResults(results)))).not.toContain('models/formatted_a.sql');
  });

  it('offers a single download only for a file that produced output', () => {
    expect(hasOutput(results[0]!)).toBe(true);
    expect(hasOutput(reviewFile({ path: 'x.sql', text: 'SELECT 1' }, pg))).toBe(false);
    expect(hasOutput({ path: 'x.sql', status: 'error', input: 'x', output: 'x', issues: [] })).toBe(false);
  });

  it('summarises and exports a review', () => {
    const review = [reviewFile({ path: 'x.sql', text: 'SELECT * FROM t' }, pg)];
    expect(summarise(review)).toMatchObject({ files: 1, withIssues: 1 });
    expect(reviewMarkdown(review, 'Review')).toContain('**x.sql**');
    expect(reviewCsv(review).split('\r\n')[0]).toBe('file,severity,line,finding');
  });
});
