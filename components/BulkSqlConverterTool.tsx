'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ACTION_PREFIX,
  collectOutputs,
  convertFile,
  fitCell,
  formatFile,
  hasOutput,
  inSkippedFolder,
  isSqlFile,
  MAX_FILE_BYTES,
  outputName,
  relativePath,
  reviewCsv,
  reviewFile,
  reviewMarkdown,
  summarise,
  syntaxProbe,
  zipOutputs,
  type BatchAction,
  type BatchFile,
  type BatchOutput,
  type BatchResult,
  type BatchStatus,
} from '@/lib/batch';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { DEFAULT_FORMAT, type FormatSettings } from '@/lib/format';
import { isLegacyWorkbook, isSheetFile, MAX_SHEET_BYTES, readSheet, type SheetDoc } from '@/lib/sheets';
import { usePersistentState } from '@/lib/settings';
import { supportsValidation } from '@/lib/validate';
import { SqlEditor } from '@/components/SqlEditor';
import { ToolHeader } from '@/components/ToolHeader';
import { ChevronIcon, DownloadIcon, FolderIcon, PlayIcon, SwapIcon, UploadIcon } from '@/components/icons';
import { Button, CopyButton, DialectSelect, Note, Panel, Segmented, Toggle } from '@/components/ui';

interface Picked {
  /** What gets processed: each SQL file, and each SQL cell of each spreadsheet. */
  files: BatchFile[];
  /** Plain SQL files among them. */
  sqlFiles: number;
  /** Spreadsheets with SQL in them, by path, to be rebuilt with the results. */
  sheets: Map<string, SheetDoc>;
  /** Spreadsheets read that held no SQL. */
  noSqlSheets: number;
  /** Old .xls workbooks, which cannot be read. */
  legacy: string[];
  /** Spreadsheets that could not be read, with why. */
  unreadable: string[];
  /** SQL files left out because they sit in a dependency or build folder. */
  skippedFolders: number;
  /** Files too large to process in a tab. */
  tooLarge: string[];
  /** Non-SQL files seen, for the summary. */
  other: number;
  name: string;
}

type Filter = 'all' | 'changed' | 'issues' | 'errors';

/** Read every entry of a dropped folder, recursively. readEntries returns at most 100 at a time. */
async function readEntry(entry: FileSystemEntry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path: `${prefix}${entry.name}`, file });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

/** A name not yet taken in a folder: `name`, then `name (2)`, `name (3)`… Nothing is ever written over. */
async function freeName(dir: FileSystemDirectoryHandle, name: string, kind: 'file' | 'directory'): Promise<string> {
  const dot = kind === 'file' ? name.lastIndexOf('.') : -1;
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try {
      if (kind === 'file') await dir.getFileHandle(candidate);
      else await dir.getDirectoryHandle(candidate);
    } catch (error) {
      if ((error as DOMException).name === 'NotFoundError') return candidate;
    }
  }
}

/** Write one result at a path under a folder, making its sub-folders as needed. */
async function writeInto(dir: FileSystemDirectoryHandle, path: string, data: Uint8Array | string): Promise<void> {
  const parts = path.split('/');
  const name = parts.pop()!;
  let folder = dir;
  for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true });
  const handle = await folder.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(new Blob([data as BlobPart]));
  await writable.close();
}

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
};
const mimeFor = (path: string) => MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'text/plain;charset=utf-8';

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What is ready to run, in words: "3 SQL files and 14 queries in 2 spreadsheets". */
function readyText(p: Picked): string {
  const queries = p.files.length - p.sqlFiles;
  const parts = [
    p.sqlFiles > 0 ? plural(p.sqlFiles, 'SQL file', 'SQL files') : '',
    p.sheets.size > 0 ? `${plural(queries, 'query', 'queries')} in ${plural(p.sheets.size, 'spreadsheet', 'spreadsheets')}` : '',
  ].filter(Boolean);
  return parts.join(' and ') || 'no SQL';
}

/** Let the browser paint between files, so a big folder shows progress instead of freezing. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Format, convert or review every SQL file in a folder, from one place.
 *
 * The folder is read in the tab, each file goes through the same code as the
 * single-query tool, and the results come back in the same format, named for what
 * was done: one file as that file (`formatted_report.sql`), a workbook as a workbook,
 * a folder as one zip laid out like it — or written into a folder the person picks,
 * where the browser allows it. Nothing is written over the originals.
 */
export function BulkSqlConverterTool() {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [action, setAction] = useState<BatchAction>('format');
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);
  const [fromId, setFromId] = usePersistentState('convert-from', 'transactsql');
  const [toId, setToId] = usePersistentState('convert-to', DEFAULT_DIALECT_ID);
  const [formatSettings] = usePersistentState<FormatSettings>('format', DEFAULT_FORMAT);
  const [checkSyntax, setCheckSyntax] = useState(true);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [ranAction, setRanAction] = useState<BatchAction>('format');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** Files whose Jinja control blocks kept them out of the syntax check. */
  const [syntaxSkipped, setSyntaxSkipped] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  /** Writing into a chosen folder needs the File System Access API: Chrome and Edge. */
  const [canSaveToFolder, setCanSaveToFolder] = useState(false);
  const [saved, setSaved] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  useEffect(() => setCanSaveToFolder('showDirectoryPicker' in window), []);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  const ingest = useCallback(async (entries: { path: string; file: File }[], name: string) => {
    setReading(true);
    setResults(null);
    try {
      const files: BatchFile[] = [];
      const tooLarge: string[] = [];
      const sheets = new Map<string, SheetDoc>();
      const legacy: string[] = [];
      const unreadable: string[] = [];
      let skippedFolders = 0;
      let other = 0;
      let sqlFiles = 0;
      let noSqlSheets = 0;
      for (const { path, file } of entries) {
        const sheet = isSheetFile(path);
        if (!sheet && !isSqlFile(path)) {
          if (isLegacyWorkbook(path)) legacy.push(path);
          else other++;
          continue;
        }
        if (inSkippedFolder(path)) {
          skippedFolders++;
          continue;
        }
        if (file.size > (sheet ? MAX_SHEET_BYTES : MAX_FILE_BYTES)) {
          tooLarge.push(path);
          continue;
        }
        if (!sheet) {
          files.push({ path, text: await file.text() });
          sqlFiles++;
          continue;
        }
        try {
          const doc = readSheet(new Uint8Array(await file.arrayBuffer()), path);
          if (doc.cells.length === 0) {
            noSqlSheets++;
            continue;
          }
          sheets.set(path, doc);
          for (const cell of doc.cells) files.push({ path: `${path} › ${cell.label}`, text: cell.text, origin: { container: path, ref: cell.ref } });
        } catch (error) {
          unreadable.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // By file, keeping a spreadsheet's cells in sheet and reading order.
      files.sort((a, b) => (a.origin?.container ?? a.path).localeCompare(b.origin?.container ?? b.path));
      setPicked({ files, sqlFiles, sheets, noSqlSheets, legacy, unreadable, skippedFolders, tooLarge, other, name });
    } finally {
      setReading(false);
    }
  }, []);

  const onInput = (list: FileList | null, viaFolder: boolean) => {
    if (!list || list.length === 0) return;
    const files = [...list];
    const first = files[0]!.webkitRelativePath;
    const name = viaFolder && first ? first.split('/')[0]! : `${files.length} file${files.length === 1 ? '' : 's'}`;
    void ingest(
      files.map((file) => ({ path: viaFolder && file.webkitRelativePath ? relativePath(file.webkitRelativePath) : file.name, file })),
      name,
    );
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const items = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => !!x);
    const out: { path: string; file: File }[] = [];
    for (const entry of items) await readEntry(entry, '', out);
    const single = items.length === 1 && items[0]!.isDirectory;
    void ingest(
      out.map((o) => ({ ...o, path: single ? relativePath(o.path) : o.path })),
      single ? items[0]!.name : `${out.length} files`,
    );
  };

  const run = async () => {
    if (!picked) return;
    const started = performance.now();
    const out: BatchResult[] = [];
    setProgress({ done: 0, total: picked.files.length });
    setOpen(null);
    setFilter('all');
    setSaved(null);
    const dialect = getDialect(dialectId);
    const from = getDialect(fromId);
    const to = getDialect(toId);
    const validate = action === 'review' && checkSyntax && supportsValidation(dialectId) ? (await import('@/lib/validate')).validateSql : null;
    let skipped = 0;

    for (const [i, file] of picked.files.entries()) {
      let result: BatchResult;
      if (action === 'format') result = formatFile(file, dialect, formatSettings);
      else if (action === 'convert') result = convertFile(file, from, to);
      else {
        result = reviewFile(file, dialect);
        const probe = validate ? syntaxProbe(file.text) : null;
        if (probe && 'skipped' in probe) skipped++;
        if (validate && probe && 'sql' in probe) {
          try {
            const errors = await validate(probe.sql, dialectId);
            for (const err of errors.slice(0, 5)) {
              result.issues.unshift({ severity: 'error', title: `Syntax: ${err.message}`, line: err.line });
            }
            if (errors.length > 0) result.status = 'issues';
          } catch {
            // A parser failure is not the file's fault; the other checks still stand.
          }
        }
      }
      result = fitCell({ ...result, origin: file.origin }, file.origin ? picked.sheets.get(file.origin.container)?.kind : undefined);
      out.push(result);
      if (i % 5 === 4 || i === picked.files.length - 1) {
        setProgress({ done: i + 1, total: picked.files.length });
        await breathe();
      }
    }
    setElapsed(performance.now() - started);
    setSyntaxSkipped(skipped);
    setResults(out);
    setRanAction(action);
    setProgress(null);
  };

  const summary = useMemo(() => (results ? summarise(results) : null), [results]);
  const shown = useMemo(() => {
    if (!results) return [];
    return results.filter((r) =>
      filter === 'all'
        ? true
        : filter === 'changed'
          ? r.output !== undefined && r.output !== r.input
          : filter === 'issues'
            ? r.issues.length > 0
            : r.status === 'error',
    );
  }, [results, filter]);

  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // A chosen folder names the zip; loose files ("3 files") get a plain name instead.
  const base = !picked || /^\d+ files?$/.test(picked.name) ? 'sql_files' : picked.name.replace(/[^\w.-]+/g, '_');
  /** Every file to hand back, whole: SQL files, and spreadsheets rebuilt with their new cells. */
  const outputs = useMemo(() => (results && picked ? collectOutputs(results, picked.sheets) : []), [results, picked]);
  /** One file in, one file out — no zip for a single file. */
  const single = outputs.length === 1 ? outputs[0]! : null;
  const singleFailed = !!results && results.every((r) => r.status === 'error');
  const sourceOf = (r: BatchResult) => r.origin?.container ?? r.path;

  const downloadOutput = (o: BatchOutput) => save(new Blob([o.data as BlobPart], { type: mimeFor(o.path) }), outputName(o.path, ranAction));
  const downloadZip = () => {
    if (!results || !picked) return;
    const zip = zipOutputs(collectOutputs(results, picked.sheets, onlyChanged));
    save(new Blob([zip as BlobPart], { type: 'application/zip' }), `${ACTION_PREFIX[ranAction]}_${base}.zip`);
  };
  const downloadFile = (result: BatchResult) => {
    const o = outputs.find((x) => x.path === sourceOf(result));
    if (o && hasOutput(result)) downloadOutput(o);
  };
  const saveToFolder = async () => {
    if (!results || !picked) return;
    const list = single ? [single] : collectOutputs(results, picked.sheets, onlyChanged);
    if (list.length === 0) return;
    let root: FileSystemDirectoryHandle;
    try {
      const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      root = await picker({ id: 'sqlparity-results', mode: 'readwrite' });
    } catch {
      return; // Closed the picker without choosing.
    }
    try {
      if (single) {
        const name = await freeName(root, outputName(single.path, ranAction), 'file');
        await writeInto(root, name, single.data);
        setSaved({ tone: 'ok', text: `Saved ${name} in ${root.name}.` });
      } else {
        // Into a new folder of its own, so nothing already there is touched.
        const folder = await freeName(root, `${ACTION_PREFIX[ranAction]}_${base}`, 'directory');
        const dir = await root.getDirectoryHandle(folder, { create: true });
        for (const o of list) await writeInto(dir, o.path, o.data);
        setSaved({ tone: 'ok', text: `Saved ${plural(list.length, 'file', 'files')} in ${root.name ? `${root.name}/` : ''}${folder}, laid out like the original.` });
      }
    } catch (error) {
      setSaved({ tone: 'warn', text: `Could not save into that folder: ${error instanceof Error ? error.message : String(error)}` });
    }
  };
  const unit = (n: number) => (picked && picked.sheets.size > 0 ? plural(n, 'query', 'queries') : plural(n, 'file', 'files'));
  const downloadCsv = () => {
    if (!results) return;
    save(new Blob([reviewCsv(results)], { type: 'text/csv;charset=utf-8' }), `${ACTION_PREFIX.review}_${base}.csv`);
  };

  return (
    <div className="space-y-5">
      <ToolHeader
        href="/bulk-sql-converter/"
        description="Choose a folder — a dbt project, a repository’s queries, a workbook of report SQL — and format, convert or review every file in it at once, including SQL kept in Excel and CSV cells. Results come back in the same format and named for what was done: report.sql formatted is formatted_report.sql, and a workbook comes back as a workbook. The originals are never touched."
      />

      <Panel
        step={1}
        title="Choose a folder"
        description={
          picked
            ? `${picked.name}: ${readyText(picked)} ready.`
            : 'Every SQL file in it and its sub-folders is read in this tab — and every query kept in an Excel or CSV file.'
        }
        actions={
          picked ? (
            <Button variant="ghost" icon={<UploadIcon />} onClick={() => folderInput.current?.click()}>
              Choose another
            </Button>
          ) : undefined
        }
      >
        <input
          ref={folderInput}
          type="file"
          className="sr-only"
          // Non-standard but supported by every current browser: pick a whole folder.
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          multiple
          onChange={(e) => {
            onInput(e.target.files, true);
            e.target.value = '';
          }}
        />
        <input
          ref={filesInput}
          type="file"
          className="sr-only"
          accept=".sql,.ddl,.dml,.hql,.pgsql,.psql,.tsql,.prc,.xlsx,.xlsm,.csv,.tsv"
          multiple
          onChange={(e) => {
            onInput(e.target.files, false);
            e.target.value = '';
          }}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => void onDrop(e)}
          className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors sm:flex-row sm:text-left ${
            dragging ? 'border-accent-500 bg-accent-500/10' : 'border-[var(--border-strong)] bg-[var(--surface-sunken)]'
          }`}
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] text-accent-600 shadow-[var(--shadow-control)] dark:text-accent-400">
            {reading ? <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <FolderIcon className="size-6" />}
          </span>
          <div className="sm:mr-auto">
            <p className="text-[14.5px] font-semibold">{reading ? 'Reading the folder…' : 'Drop a folder here'}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-500 dark:text-ink-400">
              SQL files, and SQL in .xlsx and .csv cells. Skips {['node_modules', 'target', 'dbt_packages', '.git'].join(', ')}. Nothing is uploaded.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" icon={<FolderIcon />} onClick={() => folderInput.current?.click()}>
              Choose folder
            </Button>
            <Button onClick={() => filesInput.current?.click()}>Choose files</Button>
          </div>
        </div>

        {picked && (
          <div className="mt-4 space-y-2">
            {picked.files.length === 0 && picked.unreadable.length === 0 && (
              <Note tone="warn">No SQL was found: no SQL files, and no spreadsheet cells holding a query.</Note>
            )}
            {picked.unreadable.map((u) => (
              <Note key={u} tone="warn">
                {u}
              </Note>
            ))}
            {picked.legacy.length > 0 && (
              <Note>
                Older .xls workbooks cannot be read: {picked.legacy.slice(0, 3).join(', ')}
                {picked.legacy.length > 3 ? '…' : ''}. Open {picked.legacy.length === 1 ? 'it' : 'them'} in Excel and save as .xlsx.
              </Note>
            )}
            {picked.noSqlSheets > 0 && picked.files.length > 0 && (
              <Note>{plural(picked.noSqlSheets, 'spreadsheet had', 'spreadsheets had')} no SQL in {picked.noSqlSheets === 1 ? 'its' : 'their'} cells and {picked.noSqlSheets === 1 ? 'was' : 'were'} left out.</Note>
            )}
            {(picked.skippedFolders > 0 || picked.tooLarge.length > 0) && (
              <Note>
                {picked.skippedFolders > 0 &&
                  `${picked.skippedFolders} SQL file${picked.skippedFolders === 1 ? '' : 's'} in dependency or build folders left out. `}
                {picked.tooLarge.length > 0 &&
                  `${picked.tooLarge.length} file${picked.tooLarge.length === 1 ? '' : 's'} too large to process in a tab (over 1 MB for SQL, 25 MB for a spreadsheet) left out: ${picked.tooLarge.slice(0, 3).join(', ')}${picked.tooLarge.length > 3 ? '…' : ''}.`}
              </Note>
            )}
          </div>
        )}
      </Panel>

      {picked && picked.files.length > 0 && (
        <Panel step={2} title="What to do with them">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <Segmented
              label="Action"
              value={action}
              onChange={(v) => setAction(v)}
              options={[
                { value: 'format', label: 'Format' },
                { value: 'convert', label: 'Convert' },
                { value: 'review', label: 'Review' },
              ]}
            />
            {action === 'convert' ? (
              <>
                <div className="w-52">
                  <DialectSelect value={fromId} onChange={setFromId} label="From" />
                </div>
                <Button
                  icon={<SwapIcon className="rotate-90" />}
                  onClick={() => {
                    setFromId(toId);
                    setToId(fromId);
                  }}
                >
                  Swap
                </Button>
                <div className="w-52">
                  <DialectSelect value={toId} onChange={setToId} label="To" />
                </div>
              </>
            ) : (
              <div className="w-56">
                <DialectSelect value={dialectId} onChange={setDialectId} label="Dialect" />
              </div>
            )}
            {action === 'review' && supportsValidation(dialectId) && (
              <div className="self-center">
                <Toggle checked={checkSyntax} onChange={setCheckSyntax} label="Check syntax too" hint="Slower on large folders" />
              </div>
            )}
            <button
              type="button"
              onClick={() => void run()}
              disabled={!!progress}
              className="ml-auto inline-flex h-11 items-center gap-2.5 rounded-xl bg-gradient-to-b from-accent-500 to-accent-600 px-5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_8px_20px_-8px_oklch(0.55_0.18_250/0.75),0_0_0_1px_oklch(0.46_0.16_250)] transition-all hover:from-accent-600 hover:to-accent-700 active:translate-y-px disabled:opacity-50"
            >
              <PlayIcon className="size-4" />
              {progress ? `${progress.done} of ${progress.total}…` : `${action === 'format' ? 'Format' : action === 'convert' ? 'Convert' : 'Review'} ${unit(picked.files.length)}`}
            </button>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-500 dark:text-ink-400">
            {action === 'format' && (
              <>
                Uses your <Link href="/sql-formatter/" className="text-accent-700 hover:underline dark:text-accent-400">formatter settings</Link>. dbt templates such as <code className="font-mono">{"{{ ref('…') }}"}</code> are kept as they are.
              </>
            )}
            {action === 'convert' && 'Each file gets the same rewrites as the SQL Converter, and lists anything it would not guess at.'}
            {action === 'review' && 'The optimizer’s checks and the safety checks, on every file — with syntax errors too, for PostgreSQL, MySQL and Athena/Trino.'}
          </p>
          {progress && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink-500/12">
              <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
          )}
        </Panel>
      )}

      {results && summary && (
        <Panel
          step={3}
          tone="primary"
          title="Results"
          description={`${unit(summary.files)} in ${Math.max(1, Math.round(elapsed)).toLocaleString('en-US')} ms.`}
          actions={
            ranAction === 'review' ? (
              <>
                <CopyButton text={reviewMarkdown(results, `SQL review: ${picked?.name ?? 'folder'}`)} label="Copy as Markdown" />
                <Button variant="primary" icon={<DownloadIcon />} onClick={downloadCsv}>
                  Download CSV
                </Button>
              </>
            ) : single ? (
              <>
                {canSaveToFolder && (
                  <Button icon={<FolderIcon />} onClick={() => void saveToFolder()} disabled={singleFailed} title="Write the file into a folder you choose">
                    Save to folder
                  </Button>
                )}
                <Button variant="primary" icon={<DownloadIcon />} onClick={() => downloadOutput(single)} disabled={singleFailed}>
                  Download {outputName(single.path, ranAction)}
                </Button>
              </>
            ) : (
              <>
                <Toggle checked={onlyChanged} onChange={setOnlyChanged} label="Only changed files" />
                {canSaveToFolder && (
                  <Button icon={<FolderIcon />} onClick={() => void saveToFolder()} title="Write the results into a new folder inside one you choose, laid out like the original">
                    Save to folder
                  </Button>
                )}
                <Button variant="primary" icon={<DownloadIcon />} onClick={downloadZip}>
                  Download {ACTION_PREFIX[ranAction]}_{base}.zip
                </Button>
              </>
            )
          }
        >
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label={picked && picked.sheets.size > 0 ? 'Queries' : 'Files'} value={summary.files} />
            <Tile label={ranAction === 'review' ? 'Clean' : 'Changed'} value={ranAction === 'review' ? summary.files - summary.withIssues : summary.changed} />
            <Tile label={ranAction === 'convert' ? 'Need a person' : 'With findings'} value={summary.withIssues} warn={summary.withIssues > 0} />
            <Tile label="Could not process" value={summary.errors} warn={summary.errors > 0} />
          </dl>

          {saved && (
            <div className="mt-4">
              <Note tone={saved.tone === 'warn' ? 'warn' : undefined}>{saved.text}</Note>
            </div>
          )}

          {ranAction === 'review' && syntaxSkipped > 0 && (
            <div className="mt-4">
              <Note>
                {syntaxSkipped} file{syntaxSkipped === 1 ? ' has' : 's have'} Jinja control blocks (<code className="font-mono">{'{% … %}'}</code>), so
                the syntax check left {syntaxSkipped === 1 ? 'it' : 'them'} out: which branch is the real SQL depends on values only dbt knows.
                The other checks still ran.
              </Note>
            </div>
          )}

          <div className="mt-5 mb-3">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: `All ${summary.files}` },
                ...(ranAction !== 'review' ? [{ value: 'changed' as const, label: `Changed ${summary.changed}` }] : []),
                { value: 'issues', label: `Findings ${summary.withIssues}` },
                { value: 'errors', label: `Errors ${summary.errors}` },
              ]}
            />
          </div>

          <ul className="divide-y divide-[var(--border-card)] overflow-hidden rounded-xl border border-[var(--border-card)]">
            {shown.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-ink-500 dark:text-ink-400">Nothing in this view.</li>}
            {shown.map((r) => (
              <FileRow
                key={r.path}
                result={r}
                action={ranAction}
                open={open === r.path}
                onToggle={() => setOpen(open === r.path ? null : r.path)}
                onDownload={() => downloadFile(r)}
                downloadName={outputName(sourceOf(r), ranAction)}
                dialectId={ranAction === 'convert' ? toId : dialectId}
                fromId={ranAction === 'convert' ? fromId : dialectId}
              />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

const STATUS: Record<BatchStatus, { label: string; tone: string }> = {
  changed: { label: 'Changed', tone: 'bg-accent-500/12 text-accent-700 dark:text-accent-300' },
  unchanged: { label: 'Already fine', tone: 'bg-ink-500/10 text-ink-500 dark:text-ink-400' },
  issues: { label: 'Needs a look', tone: 'bg-amber-500/12 text-amber-800 dark:text-amber-300' },
  clean: { label: 'Clean', tone: 'bg-[var(--signal-soft)] text-[color-mix(in_oklab,var(--signal)_70%,black)] dark:text-[var(--signal)]' },
  error: { label: 'Error', tone: 'bg-red-500/10 text-red-700 dark:text-red-300' },
};

function Tile({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${warn ? 'border-amber-300/70 dark:border-amber-700/50' : 'border-[var(--border-card)]'}`}>
      <dt className="text-[12px] font-medium text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[22px] font-semibold tabular-nums ${warn ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value.toLocaleString('en-US')}</dd>
    </div>
  );
}

function FileRow({
  result,
  action,
  open,
  onToggle,
  onDownload,
  downloadName,
  dialectId,
  fromId,
}: {
  result: BatchResult;
  action: BatchAction;
  open: boolean;
  onToggle: () => void;
  onDownload: () => void;
  downloadName: string;
  dialectId: string;
  fromId: string;
}) {
  // Split at the file's folder, so a cell's sheet name (which may hold anything) stays whole.
  const slash = (result.origin?.container ?? result.path).lastIndexOf('/');
  const folder = slash >= 0 ? result.path.slice(0, slash + 1) : '';
  const name = result.path.slice(slash + 1);
  const status = STATUS[result.status];
  const detail =
    result.error
      ? result.error
      : action === 'convert'
        ? `${result.rewrites ?? 0} rewrite${result.rewrites === 1 ? '' : 's'}${result.issues.length ? ` · ${result.issues.length} left for a person` : ''}`
        : action === 'review'
          ? result.issues.length === 0
            ? 'No findings'
            : `${result.issues.length} finding${result.issues.length === 1 ? '' : 's'}`
          : '';

  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-header)]">
        <ChevronIcon className={`size-3.5 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          <span className="text-ink-400 dark:text-ink-500">{folder}</span>
          <span className="font-semibold">{name}</span>
        </span>
        {detail && <span className="hidden max-w-[22rem] truncate text-[12.5px] text-ink-500 sm:block dark:text-ink-400">{detail}</span>}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${status.tone}`}>{status.label}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-[var(--border-card)] bg-[var(--surface-header)] px-4 py-4">
          {result.issues.length > 0 && (
            <ul className="space-y-1.5">
              {result.issues.map((issue, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed">
                  <span
                    aria-hidden="true"
                    className={`mt-[7px] size-2 shrink-0 rounded-full ${issue.severity === 'error' || issue.severity === 'high' ? 'bg-red-500' : issue.severity === 'medium' ? 'bg-amber-500' : 'bg-ink-400'}`}
                  />
                  <span>
                    {issue.line !== undefined && <span className="mr-1.5 font-mono text-[12px] text-ink-500">line {issue.line}</span>}
                    {issue.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result.output !== undefined && result.output !== result.input ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-ink-500 dark:text-ink-400">Before</p>
                <SqlEditor value={result.input} readOnly dialectId={fromId} minHeight="180px" />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <p className="text-[12px] font-medium text-ink-500 dark:text-ink-400">After</p>
                  {hasOutput(result) && (
                    <button
                      type="button"
                      onClick={onDownload}
                      className="inline-flex items-center gap-1 truncate font-mono text-[12px] text-accent-700 hover:underline dark:text-accent-400"
                    >
                      <DownloadIcon className="size-3.5 shrink-0" />
                      {downloadName}
                    </button>
                  )}
                </div>
                <SqlEditor value={result.output} readOnly dialectId={dialectId} minHeight="180px" />
              </div>
            </div>
          ) : (
            result.issues.length === 0 && !result.error && <p className="text-[13px] text-ink-500 dark:text-ink-400">Nothing to change in this file.</p>
          )}
        </div>
      )}
    </li>
  );
}
