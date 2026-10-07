import type { Assessment, ParityResult, ParitySpec, Verdict } from './parity';

/**
 * The sign-off report for a Parity Run: one self-contained HTML file.
 *
 * It is evidence, so three properties matter more than looks:
 *
 *   Reproducible.  Each input is identified by the SHA-256 of its bytes, and every
 *                  setting and SQL statement is printed. Anyone holding the same two
 *                  files can load them again and get the same figures.
 *   Honest.        The verdict is the one `assess` gave, worded so the report never
 *                  claims more than the run proved — a match on some columns is not
 *                  called a match.
 *   Private.       Sample values are real data, so they are left out unless the
 *                  person generating the report includes them on purpose.
 *
 * The file needs nothing but a browser: no scripts run, no fonts or images load, and
 * it prints cleanly to PDF.
 */

export interface ReportInput {
  side: 'source' | 'target';
  name: string;
  bytes: number;
  rows: number;
  columns: number;
  /** Hex SHA-256 of the file's bytes, or null when it could not be computed. */
  sha256: string | null;
  notes: string[];
}

export interface ParityReport {
  title: string;
  preparedBy: string;
  notes: string;
  generatedAt: Date;
  appVersion: string;
  inputs: [ReportInput, ReportInput];
  spec: ParitySpec;
  result: ParityResult;
  assessment: Assessment;
  includeSamples: boolean;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const n = (value: number) => value.toLocaleString('en-US');

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export const VERDICT_TEXT: Record<Verdict, { label: string; line: string }> = {
  match: {
    label: 'Match',
    line: 'Every row and every compared column is identical on both sides.',
  },
  'match-with-gaps': {
    label: 'Match on compared columns',
    line: 'No differences were found, but not every column could be compared. See the notes.',
  },
  differs: {
    label: 'Differences found',
    line: 'The target does not hold the same data as the source.',
  },
};

/** The run's own timestamp in UTC, so a report reads the same in every time zone. */
export function utcStamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function reportFilename(report: ParityReport): string {
  const slug =
    report.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'parity-run';
  const stamp = report.generatedAt.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${slug}-${stamp}.html`;
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  const p = (part / whole) * 100;
  if (p === 0) return '0%';
  if (p < 0.01) return '<0.01%';
  return `${p.toFixed(p < 1 ? 2 : 1)}%`;
}

/** Settings in a form a person can re-enter, and a machine can read back. */
export function settingsSnapshot(report: ParityReport) {
  const { spec } = report;
  return {
    match: spec.keys.length > 0 ? 'key' : 'whole rows',
    keys: spec.keys.map((k) => ({ source: k.source, target: k.target })),
    compared: spec.compare.map((c) => ({ source: c.source, target: c.target })),
    options: spec.options,
  };
}

function statRows(report: ParityReport): [string, string][] {
  const { result } = report;
  const rows: [string, string][] = [
    ['Rows in source', n(result.sourceRows)],
    ['Rows in target', n(result.targetRows)],
  ];
  if (result.keys) {
    const k = result.keys;
    rows.push(
      ['Keys on both sides', n(k.matched)],
      ['Keys only in source', n(k.onlySource)],
      ['Keys only in target', n(k.onlyTarget)],
      ['Duplicate keys (source / target)', `${n(k.sourceDuplicates)} / ${n(k.targetDuplicates)}`],
      ['Rows with an empty key (source / target)', `${n(k.sourceNulls)} / ${n(k.targetNulls)}`],
      ['Row pairs compared', n(k.comparedRows)],
    );
  }
  if (result.rowSets) {
    rows.push(
      ['Rows only in source', n(result.rowSets.onlySource)],
      ['Rows only in target', n(result.rowSets.onlyTarget)],
    );
  }
  rows.push(['Columns compared', n(result.columns.length)]);
  return rows;
}

const STYLE = `
:root{--ink:#161a26;--muted:#5b6275;--line:#dfe3ea;--soft:#f5f7fa;--accent:#2f6bde;--ok:#0f7a55;--ok-bg:#e7f6ef;--warn:#8a5a00;--warn-bg:#fdf3dc;--bad:#b42318;--bad-bg:#fdecea}
*{box-sizing:border-box}
body{margin:0;background:#eef0f4;color:var(--ink);font:14px/1.55 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.page{max-width:900px;margin:32px auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:44px 52px;box-shadow:0 10px 30px -12px rgba(22,26,38,.18)}
header{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:26px}
header .brand{font-weight:600;font-size:15px}
header .kind{margin-left:auto;color:var(--muted);font-size:12.5px}
h1{font-size:26px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
h2{font-size:15px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:13.5px;margin:18px 0 6px}
.meta{color:var(--muted);font-size:13px;margin:0}
.verdict{margin:26px 0 8px;border-radius:12px;padding:20px 22px;border:1px solid}
.verdict .label{font-size:21px;font-weight:700;letter-spacing:-.01em}
.verdict p{margin:4px 0 0}
.verdict.match{background:var(--ok-bg);border-color:#b7e2cf;color:var(--ok)}
.verdict.match-with-gaps{background:var(--warn-bg);border-color:#f0d9a2;color:var(--warn)}
.verdict.differs{background:var(--bad-bg);border-color:#f3c3be;color:var(--bad)}
.verdict ul{margin:10px 0 0;padding-left:20px;color:var(--ink)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--soft);font-weight:600;color:var(--muted);font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
code,pre,.mono{font-family:"SF Mono",Consolas,"Cascadia Mono",Menlo,monospace;font-size:12px}
.hash{word-break:break-all;color:var(--muted)}
.bad{color:var(--bad);font-weight:600}
.ok{color:var(--ok)}
ul.notes{padding-left:20px;margin:6px 0}
pre{background:#1b1f2c;color:#e4e7ef;border-radius:8px;padding:12px 14px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;margin:6px 0 14px}
.muted{color:var(--muted)}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:14px}
.sign div{border-top:1px solid var(--ink);padding-top:6px;font-size:12px;color:var(--muted);margin-top:44px}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media print{body{background:#fff}.page{margin:0;border:0;border-radius:0;box-shadow:none;padding:0}h2{break-after:avoid}table,pre{break-inside:avoid}}
`;

const MARK = `<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#20222c"/><rect x="7" y="11" width="18" height="3.6" rx="1.8" fill="#6fdcae"/><rect x="7" y="17.4" width="18" height="3.6" rx="1.8" fill="#6fdcae"/></svg>`;

export function reportHtml(report: ParityReport): string {
  const { result, assessment, spec } = report;
  const e = escapeHtml;
  const verdict = VERDICT_TEXT[assessment.verdict];
  const compared = result.keys?.comparedRows ?? 0;

  const inputRows = report.inputs
    .map(
      (input) => `<tr>
        <td>${input.side === 'source' ? 'Source' : 'Target'}</td>
        <td>${e(input.name)}</td>
        <td class="num" style="white-space:nowrap">${e(humanBytes(input.bytes))}</td>
        <td class="num">${n(input.rows)}</td>
        <td class="num">${n(input.columns)}</td>
        <td class="mono hash">${input.sha256 ? e(input.sha256) : '<span class="muted">not computed</span>'}</td>
      </tr>`,
    )
    .join('');

  const loadNotes = report.inputs.flatMap((input) =>
    input.notes.map((note) => `<li><strong>${input.side === 'source' ? 'Source' : 'Target'}:</strong> ${e(note)}</li>`),
  );

  const matching =
    spec.keys.length > 0
      ? `Rows were matched on ${spec.keys
          .map((k) => (k.source === k.target ? `<code>${e(k.source)}</code>` : `<code>${e(k.source)}</code> → <code>${e(k.target)}</code>`))
          .join(' + ')}.`
      : 'No key was chosen, so each side was compared as a whole set of rows.';

  const options = [
    spec.options.trim ? 'Leading and trailing whitespace ignored.' : null,
    spec.options.ignoreCase ? 'Text compared ignoring case.' : null,
    spec.options.emptyAsNull ? 'Empty text treated as NULL.' : null,
    spec.options.tolerance > 0 ? `Numbers within ${spec.options.tolerance} of each other treated as equal.` : null,
  ].filter(Boolean) as string[];

  const columnRows = result.columns
    .map((c) => {
      const same = c.pair.source === c.pair.target;
      const typeNote = c.pair.sourceType === c.pair.targetType ? e(c.pair.sourceType) : `${e(c.pair.sourceType)} → ${e(c.pair.targetType)}`;
      return `<tr>
        <td><code>${e(c.pair.source)}</code>${same ? '' : ` → <code>${e(c.pair.target)}</code>`}</td>
        <td class="mono muted">${typeNote}</td>
        <td class="num ${c.mismatches > 0 ? 'bad' : 'ok'}">${n(c.mismatches)}</td>
        <td class="num">${result.mode === 'key' ? percent(c.mismatches, compared) : '—'}</td>
      </tr>`;
    })
    .join('');

  let samples = '';
  if (report.includeSamples) {
    const keyHeads = spec.keys.map((k) => `<th>${e(k.source)}</th>`).join('');
    const blocks = result.columns
      .filter((c) => c.samples.length > 0)
      .map(
        (c) => `<h3>${e(c.pair.source)}</h3>
          <table><thead><tr>${keyHeads}<th>Source value</th><th>Target value</th></tr></thead><tbody>
          ${c.samples
            .map((s) => `<tr>${s.key.map((k) => `<td class="mono">${e(k)}</td>`).join('')}<td class="mono">${e(s.source)}</td><td class="mono">${e(s.target)}</td></tr>`)
            .join('')}
          </tbody></table>`,
      );
    const missing = (label: string, rows: string[][]) =>
      rows.length === 0
        ? ''
        : `<h3>${label}</h3><table><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td class="mono">${e(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const what = result.mode === 'key' ? 'Keys' : 'Rows';
    blocks.push(missing(`${what} only in the source (first ${result.onlySourceSamples.length})`, result.onlySourceSamples));
    blocks.push(missing(`${what} only in the target (first ${result.onlyTargetSamples.length})`, result.onlyTargetSamples));
    const body = blocks.filter(Boolean).join('');
    samples = body ? `<h2>Examples</h2>${body}` : '';
  } else if (assessment.verdict === 'differs') {
    samples = `<h2>Examples</h2><p class="muted">Sample values were left out of this report, because they are real data. Re-run Parity Run with the same files to see them.</p>`;
  }

  const queries = result.queries
    .map((q) => `<h3>${e(q.label)}</h3><pre>${e(q.sql)}</pre>`)
    .join('');

  const data = JSON.stringify({
    generator: `SQLParity ${report.appVersion}`,
    engine: result.engineVersion,
    generatedAt: report.generatedAt.toISOString(),
    verdict: assessment.verdict,
    inputs: report.inputs.map(({ side, name, bytes, rows, columns, sha256 }) => ({ side, name, bytes, rows, columns, sha256 })),
    settings: settingsSnapshot(report),
    figures: {
      sourceRows: result.sourceRows,
      targetRows: result.targetRows,
      keys: result.keys ?? null,
      rowSets: result.rowSets ?? null,
      columns: result.columns.map((c) => ({ source: c.pair.source, target: c.pair.target, mismatches: c.mismatches })),
    },
  }).replaceAll('<', '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="SQLParity ${e(report.appVersion)}">
<title>${e(report.title || 'Parity Run')} — sign-off report</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header>${MARK}<span class="brand">SQLParity</span><span class="kind">Parity sign-off report</span></header>

<h1>${e(report.title || 'Parity Run')}</h1>
<p class="meta">Generated ${e(utcStamp(report.generatedAt))}${report.preparedBy ? ` · Prepared by ${e(report.preparedBy)}` : ''}</p>

<section class="verdict ${assessment.verdict}">
  <div class="label">${verdict.label}</div>
  <p>${verdict.line}</p>
  ${assessment.findings.length > 0 ? `<ul>${assessment.findings.map((f) => `<li>${e(f)}</li>`).join('')}</ul>` : ''}
</section>
${assessment.gaps.length > 0 ? `<ul class="notes muted">${assessment.gaps.map((g) => `<li>${e(g)}</li>`).join('')}</ul>` : ''}
${report.notes ? `<h2>Notes</h2><p>${e(report.notes).replaceAll('\n', '<br>')}</p>` : ''}

<h2>Inputs</h2>
<table>
  <thead><tr><th>Side</th><th>File</th><th class="num">Size</th><th class="num">Rows</th><th class="num">Columns</th><th>SHA-256</th></tr></thead>
  <tbody>${inputRows}</tbody>
</table>
${loadNotes.length > 0 ? `<ul class="notes muted">${loadNotes.join('')}</ul>` : ''}

<h2>How it was compared</h2>
<p>${matching}</p>
${options.length > 0 ? `<ul class="notes">${options.map((o) => `<li>${e(o)}</li>`).join('')}</ul>` : '<p class="muted">Values were compared exactly; NULL equals NULL.</p>'}

<h2>Results</h2>
<table><tbody>${statRows(report)
    .map(([label, value]) => `<tr><td>${e(label)}</td><td class="num">${e(value)}</td></tr>`)
    .join('')}</tbody></table>

${result.columns.length > 0 ? `<h3>Columns</h3>
<table>
  <thead><tr><th>Column</th><th>Type</th><th class="num">Rows that differ</th><th class="num">Share</th></tr></thead>
  <tbody>${columnRows}</tbody>
</table>` : ''}

${samples}

<h2>Reproduce this run</h2>
<p>Load two files with the SHA-256 fingerprints above into Parity Run at <span class="mono">sqlparity.com/parity-run</span> with these settings. Every figure in this report came from the statements below, run in the browser that produced it.</p>
<pre>${e(JSON.stringify(settingsSnapshot(report), null, 2))}</pre>
${queries}

<h2>Sign-off</h2>
<div class="sign"><div>Reviewed by, and date</div><div>Approved by, and date</div></div>

<footer>Generated by SQLParity ${e(report.appVersion)} in a web browser. The data was processed on the machine that produced this report and was not uploaded anywhere.</footer>
</div>
<script type="application/json" id="sqlparity-run">${data}</script>
</body>
</html>`;
}

/** A short summary to paste into a ticket or a pull request. */
export function reportMarkdown(report: ParityReport): string {
  const { result, assessment } = report;
  const verdict = VERDICT_TEXT[assessment.verdict];
  const lines: string[] = [
    `### Parity Run: ${report.title || 'untitled'} — ${verdict.label}`,
    '',
    verdict.line,
    '',
    '| | Source | Target |',
    '| --- | --- | --- |',
    `| File | \`${report.inputs[0].name}\` | \`${report.inputs[1].name}\` |`,
    `| Rows | ${n(result.sourceRows)} | ${n(result.targetRows)} |`,
    `| SHA-256 | \`${report.inputs[0].sha256?.slice(0, 16) ?? 'n/a'}…\` | \`${report.inputs[1].sha256?.slice(0, 16) ?? 'n/a'}…\` |`,
  ];
  if (result.keys) {
    lines.push(`| Keys only on this side | ${n(result.keys.onlySource)} | ${n(result.keys.onlyTarget)} |`);
  }
  if (result.rowSets) {
    lines.push(`| Rows only on this side | ${n(result.rowSets.onlySource)} | ${n(result.rowSets.onlyTarget)} |`);
  }
  lines.push('');
  if (assessment.findings.length > 0) {
    lines.push(...assessment.findings.map((f) => `- ${f}`), '');
  }
  if (assessment.gaps.length > 0) {
    lines.push(...assessment.gaps.map((g) => `- _${g}_`), '');
  }
  lines.push(`_Generated ${utcStamp(report.generatedAt)} by SQLParity ${report.appVersion}, in the browser._`);
  return lines.join('\n');
}
