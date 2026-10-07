import { strToU8, zipSync } from 'fflate';
import { convertSql } from './convert';
import type { Dialect } from './dialects';
import { formatSql, type FormatSettings } from './format';
import { lintSql } from './lint';
import { reviewSql, type Severity } from './review';
import { EXCEL_CELL_LIMIT, type SheetDoc } from './sheets';

/**
 * Whole folders of SQL at once: format, convert or review every .sql file in a folder —
 * and every query kept in a cell of an Excel workbook or CSV (see lib/sheets.ts) —
 * keep its layout, and hand the results back — one file as that file, a folder as one zip.
 *
 * Files are read in the tab and processed by the same code as the single-query tools,
 * so a folder gets exactly what each file would get pasted in one at a time. Nothing
 * is written back to disk: the download is a copy, so a bad conversion can never
 * overwrite the only original.
 */

export type BatchAction = 'format' | 'convert' | 'review';

/** Where a query found in a spreadsheet came from. */
export interface CellOrigin {
  /** The workbook or CSV's path inside the chosen folder. */
  container: string;
  /** The cell, as the SheetDoc names it: `Sheet1!B12`. */
  ref: string;
}

export interface BatchFile {
  /** Path inside the chosen folder, with forward slashes. For a cell: `book.xlsx › Sheet1!B12`. */
  path: string;
  text: string;
  origin?: CellOrigin;
}

export interface BatchIssue {
  severity: Severity | 'error';
  title: string;
  /** 1-based line, where known. */
  line?: number;
}

export type BatchStatus = 'changed' | 'unchanged' | 'issues' | 'clean' | 'error';

export interface BatchResult {
  path: string;
  status: BatchStatus;
  input: string;
  /** Format and convert: the new text. */
  output?: string;
  /** Convert: how many rewrites, and what was left for a person. */
  rewrites?: number;
  issues: BatchIssue[];
  error?: string;
  origin?: CellOrigin;
}

/** Extensions read as SQL. Templated dbt models are .sql too. */
const SQL_FILE = /\.(sql|ddl|dml|hql|pgsql|psql|tsql|prc)$/i;

/** Folders that hold tools, dependencies or build output, not SQL anyone wrote. */
export const SKIPPED_FOLDERS = ['node_modules', '.git', 'target', 'dbt_packages', 'logs', '.venv', 'venv', '__pycache__', '.idea', '.vscode'];

/** Larger files are listed but not processed: a formatter on a 5 MB dump locks the tab. */
export const MAX_FILE_BYTES = 1024 * 1024;

export function isSqlFile(path: string): boolean {
  return SQL_FILE.test(path);
}

/** True when any folder on the path is one to skip. */
export function inSkippedFolder(path: string): boolean {
  return path.split('/').slice(0, -1).some((part) => SKIPPED_FOLDERS.includes(part.toLowerCase()));
}

/** The path inside the chosen folder: drop the folder's own name from webkitRelativePath. */
export function relativePath(fullPath: string): string {
  const parts = fullPath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : parts.join('/');
}

/** The 1-based line a character offset falls on. */
function lineOf(text: string, needle: string): number | undefined {
  const at = text.indexOf(needle);
  if (at < 0) return undefined;
  return text.slice(0, at).split('\n').length;
}

export function formatFile(file: BatchFile, dialect: Dialect, settings: FormatSettings): BatchResult {
  const outcome = formatSql(file.text, dialect, settings);
  if (outcome.error) {
    return { path: file.path, status: 'error', input: file.text, issues: [], error: outcome.error };
  }
  // Compare ignoring trailing whitespace, so a file that only lacked a final newline
  // is not reported as reformatted.
  const same = outcome.sql.trimEnd() === file.text.trimEnd();
  return {
    path: file.path,
    status: same ? 'unchanged' : 'changed',
    input: file.text,
    output: same ? file.text : `${outcome.sql.trimEnd()}\n`,
    issues: [],
  };
}

export function convertFile(file: BatchFile, from: Dialect, to: Dialect): BatchResult {
  try {
    const result = convertSql(file.text, from, to);
    const rewrites = result.changes.reduce((sum, c) => sum + c.count, 0);
    const issues: BatchIssue[] = result.unconverted.map((u) => ({
      severity: 'medium',
      title: `${u.feature}: left for a person — ${u.why}`,
      line: lineOf(file.text, u.feature.split(/[\s(]/)[0] ?? ''),
    }));
    const changed = result.sql !== file.text;
    return {
      path: file.path,
      status: issues.length > 0 ? 'issues' : changed ? 'changed' : 'unchanged',
      input: file.text,
      output: result.sql,
      rewrites,
      issues,
    };
  } catch (error) {
    return { path: file.path, status: 'error', input: file.text, issues: [], error: String(error) };
  }
}

/** The optimizer's findings and the safety checks. Syntax checking is added by the caller, which is async. */
export function reviewFile(file: BatchFile, dialect: Dialect): BatchResult {
  const issues: BatchIssue[] = [
    ...lintSql(file.text, dialect).map((f): BatchIssue => ({ severity: 'high', title: f.message })),
    ...reviewSql(file.text, dialect).map((f): BatchIssue => ({ severity: f.severity, title: f.title })),
  ];
  return { path: file.path, status: issues.length > 0 ? 'issues' : 'clean', input: file.text, issues };
}

/**
 * SQL a syntax checker can read, from a file that may be a dbt model.
 *
 * `{{ ... }}` expressions become a stand-in name and `{# ... #}` comments become
 * blank, with every line break kept so a reported line number still points at the
 * right line of the file. A file with `{% ... %}` control blocks is not checked at
 * all: which branch is the real SQL depends on values only dbt knows, and reporting
 * a syntax error in a branch that never runs would be wrong.
 */
export function syntaxProbe(text: string): { sql: string } | { skipped: true } {
  if (/\{%/.test(text)) return { skipped: true };
  const keepLines = (match: string, stand: string) => stand + '\n'.repeat((match.match(/\n/g) ?? []).length);
  return {
    sql: text.replace(/\{#[\s\S]*?#\}/g, (m) => keepLines(m, ' ')).replace(/\{\{[\s\S]*?\}\}/g, (m) => keepLines(m, '__x__')),
  };
}

export interface BatchSummary {
  files: number;
  changed: number;
  withIssues: number;
  errors: number;
  issues: number;
}

export function summarise(results: BatchResult[]): BatchSummary {
  return {
    files: results.length,
    changed: results.filter((r) => r.status === 'changed' || (r.output !== undefined && r.output !== r.input)).length,
    withIssues: results.filter((r) => r.issues.length > 0).length,
    errors: results.filter((r) => r.status === 'error').length,
    issues: results.reduce((sum, r) => sum + r.issues.length, 0),
  };
}

/** The word a download's name starts with, so a result is never mistaken for its original. */
export const ACTION_PREFIX: Record<BatchAction, string> = { format: 'formatted', convert: 'converted', review: 'reviewed' };

/**
 * The name to save a result as: the action, then the original name, so `report.sql`
 * formatted downloads as `formatted_report.sql`. Only the file name gets the prefix;
 * any folders in the path are dropped, since a single download has none.
 */
export function outputName(path: string, action: BatchAction): string {
  const name = path.slice(path.lastIndexOf('/') + 1) || 'query.sql';
  return `${ACTION_PREFIX[action]}_${name}`;
}

/** Whether a result has something worth downloading on its own: it ran, and it produced text. */
export function hasOutput(result: BatchResult): boolean {
  return result.status !== 'error' && result.output !== undefined;
}

/** A query's text as it goes back into a cell: without the final newline a file wants. */
const cellText = (text: string) => text.replace(/\n+$/, '');

/**
 * A result from an Excel cell that grew past what a cell holds is not written back:
 * Excel would cut it off. The cell keeps its query, and the result says why.
 */
export function fitCell(result: BatchResult, kind: SheetDoc['kind'] | undefined): BatchResult {
  if (kind !== 'xlsx' || result.output === undefined || cellText(result.output).length <= EXCEL_CELL_LIMIT) return result;
  return {
    ...result,
    status: 'issues',
    output: result.input,
    issues: [
      ...result.issues,
      { severity: 'medium', title: `The result is longer than an Excel cell holds (${EXCEL_CELL_LIMIT.toLocaleString('en-US')} characters), so the cell was left as it was.` },
    ],
  };
}

/** One file to hand back: a SQL file's new text, or a whole workbook or CSV rebuilt. */
export interface BatchOutput {
  path: string;
  data: Uint8Array | string;
  changed: boolean;
}

/**
 * Every file to hand back, in the order the results came. A spreadsheet's queries are
 * gathered into one output per file, rebuilt with only the changed cells replaced;
 * a spreadsheet nothing changed in comes back exactly as it was read.
 */
export function collectOutputs(results: BatchResult[], sheets: Map<string, SheetDoc> = new Map(), onlyChanged = false): BatchOutput[] {
  const outputs: BatchOutput[] = [];
  const changes = new Map<string, Map<string, string>>();
  for (const r of results) {
    if (!r.origin) {
      const out = r.output ?? r.input;
      if (!onlyChanged || out !== r.input) outputs.push({ path: r.path, data: out, changed: out !== r.input });
      continue;
    }
    const { container, ref } = r.origin;
    if (!changes.has(container)) {
      changes.set(container, new Map());
      outputs.push({ path: container, data: '', changed: false });
    }
    if (r.status !== 'error' && r.output !== undefined && cellText(r.output) !== cellText(r.input)) {
      changes.get(container)!.set(ref, cellText(r.output));
    }
  }
  return outputs.flatMap((o) => {
    const cells = changes.get(o.path);
    const doc = sheets.get(o.path);
    if (!cells || !doc) return [o];
    if (cells.size === 0) return onlyChanged ? [] : [{ path: o.path, data: doc.bytes, changed: false }];
    return [{ path: o.path, data: doc.write(cells), changed: true }];
  });
}

export function zipOutputs(outputs: BatchOutput[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const o of outputs) entries[o.path] = typeof o.data === 'string' ? strToU8(o.data) : o.data;
  return zipSync(entries, { level: 6 });
}

/**
 * A zip of the results, laid out as the folder was. The files inside keep their own
 * names, because other files find them by name — a dbt `ref('orders')` is
 * `orders.sql`, a script runs `\i setup.sql` — and renaming them would break the
 * folder; the zip itself carries the action in its name. Files that failed keep their
 * original text, so the zip is always the whole folder; `onlyChanged` leaves out the
 * files the action did not touch.
 */
export function zipResults(results: BatchResult[], onlyChanged = false, sheets: Map<string, SheetDoc> = new Map()): Uint8Array {
  return zipOutputs(collectOutputs(results, sheets, onlyChanged));
}

/** The review as Markdown, for a pull request or a ticket. */
export function reviewMarkdown(results: BatchResult[], title: string): string {
  const s = summarise(results);
  const lines = [`### ${title}`, '', `${s.files} files · ${s.withIssues} with findings · ${s.issues} findings in all`, ''];
  for (const r of results.filter((x) => x.issues.length > 0 || x.error)) {
    lines.push(`**${r.path}**`);
    if (r.error) lines.push(`- error: ${r.error}`);
    for (const i of r.issues) lines.push(`- ${i.severity}${i.line ? ` (line ${i.line})` : ''}: ${i.title}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** The review as CSV, one finding per row. */
export function reviewCsv(results: BatchResult[]): string {
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const rows = ['file,severity,line,finding'];
  for (const r of results) {
    if (r.error) rows.push([r.path, 'error', '', r.error].map(q).join(','));
    for (const i of r.issues) rows.push([r.path, i.severity, i.line ? String(i.line) : '', i.title].map(q).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
