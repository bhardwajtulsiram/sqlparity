'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { SqlEditor, type SqlEditorApi } from '@/components/SqlEditor';
import { Button, CopyButton, Note, Panel } from '@/components/ui';
import {
  completionSchema,
  csvHeaderWarning,
  defaultCompletionTable,
  csvSniffWarning,
  fileKind,
  formatCell,
  humanSize,
  isNullCell,
  loadSql,
  MAX_DISPLAY_ROWS,
  shapeResult,
  tableNameFor,
  toTsv,
  type QueryShape,
} from '@/lib/scratchpad';

const STARTER = `-- Drop a CSV or Parquet file on the left, then query it.
SELECT version() AS duckdb_version, current_date AS today`;

interface LoadedFile {
  table: string;
  filename: string;
  bytes: number;
  rows: number;
  columns: string[];
}

type EngineState = 'idle' | 'starting' | 'ready' | 'failed';

export function SqlScratchpadTool() {
  const [sql, setSql] = useState(STARTER);
  const [engine, setEngine] = useState<EngineState>('idle');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [result, setResult] = useState<QueryShape | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  const db = useRef<AsyncDuckDB | null>(null);
  const conn = useRef<AsyncDuckDBConnection | null>(null);

  const editor = useRef<SqlEditorApi | null>(null);

  /**
   * A mirror of the editor's text.
   *
   * Only a fallback for the first render, before SqlEditor has assigned its apiRef —
   * `run` prefers the editor's own document, which is the authoritative copy. Keeping
   * the text out of `run`'s dependencies also stops the Ctrl+Enter listener being torn
   * down and re-added on every keystroke.
   */
  const sqlRef = useRef(sql);
  const editSql = useCallback((next: string) => {
    sqlRef.current = next;
    setSql(next);
  }, []);

  useEffect(() => {
    return () => {
      void conn.current?.close();
    };
  }, []);

  /** Start the engine on first use, not on page load — it is a 7.7 MB download. */
  const connection = useCallback(async (): Promise<AsyncDuckDBConnection> => {
    if (conn.current) return conn.current;
    setEngine('starting');
    setEngineError(null);
    try {
      const { getDuckDb } = await import('@/lib/duckdb');
      const instance = await getDuckDb();
      db.current = instance;
      conn.current = await instance.connect();
      setEngine('ready');
      return conn.current;
    } catch (error) {
      setEngine('failed');
      setEngineError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, []);

  const addFiles = useCallback(
    async (incoming: FileList | File[]) => {
      const list = [...incoming];
      if (list.length === 0) return;

      setBusy(true);
      setQueryError(null);
      setLoadWarnings([]);
      try {
        const connected = await connection();
        const { registerFile, runQuery } = await import('@/lib/duckdb');
        const instance = db.current;
        if (!instance) throw new Error('The engine is not running.');

        const loaded: LoadedFile[] = [];
        const rejected: string[] = [];
        const warnings: string[] = [];
        const taken = new Set(files.map((f) => f.table));

        for (const file of list) {
          const kind = fileKind(file.name);
          if (kind === 'unsupported') {
            rejected.push(file.name);
            continue;
          }
          const table = tableNameFor(file.name, taken);
          taken.add(table);

          await registerFile(instance, file.name, file);
          await connected.query(loadSql(table, file.name, kind));

          const counted = await runQuery(connected, `SELECT count(*) FROM "${table}"`);
          const described = await runQuery(connected, `DESCRIBE "${table}"`);

          const columns = described.rows.map((row) => String(row[0]));
          const sniff = csvSniffWarning(kind, columns) ?? csvHeaderWarning(kind, columns);
          if (sniff) warnings.push(`${file.name}: ${sniff}`);

          loaded.push({
            table,
            filename: file.name,
            bytes: file.size,
            rows: Number(counted.rows[0]?.[0] ?? 0),
            columns,
          });
        }

        if (loaded.length > 0) {
          setFiles((current) => [...current, ...loaded]);
          // Land on something that runs, so the first result is one click away.
          editSql(`SELECT *\nFROM "${loaded[0].table}"\nLIMIT 100`);
        }
        if (rejected.length > 0) {
          warnings.push(
            `Could not read ${rejected.join(', ')} — this reads CSV, TSV, Parquet and JSON. A spreadsheet needs exporting to CSV first.`,
          );
        }
        setLoadWarnings(warnings);
      } catch (error) {
        setQueryError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [connection, editSql, files],
  );

  const run = useCallback(async () => {
    // The editor's own document is authoritative. sqlRef is the fallback for the
    // moment before the editor has mounted.
    const current = editor.current?.getText() ?? sqlRef.current;
    if (current.trim() === '') return;
    setBusy(true);
    setQueryError(null);
    try {
      const connected = await connection();
      const { runQuery } = await import('@/lib/duckdb');
      const outcome = await runQuery(connected, current);
      setResult(shapeResult(outcome.columns, outcome.rows, outcome.totalRows));
      setElapsed(outcome.elapsedMs);
    } catch (error) {
      setResult(null);
      setElapsed(null);
      setQueryError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [connection]);

  // Ctrl/Cmd+Enter is what every SQL client binds to run. The editor binds it too, for
  // the case where it has focus; this covers the rest of the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The editor already ran it and marked the event handled. Without this the
      // query would run twice whenever the editor had focus.
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const resultText = useMemo(() => (result ? toTsv(result.columns, result.rows) : ''), [result]);

  // What the editor should suggest: only tables that are actually loaded.
  const schema = useMemo(() => completionSchema(files), [files]);
  const defaultTable = useMemo(() => defaultCompletionTable(files), [files]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SQL scratchpad</h1>
          <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
            Query a CSV or Parquet file with real SQL. The engine runs in this tab.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <EngineBadge state={engine} />
          <Button variant="primary" onClick={run} disabled={busy || sql.trim() === ''}>
            {busy ? 'Working…' : 'Run'}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <Panel step={1} title="Your data">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
              dragging
                ? 'border-accent-500 bg-accent-500/10'
                : 'border-[var(--border-card)] hover:border-accent-500'
            }`}
          >
            <input
              type="file"
              multiple
              accept=".csv,.tsv,.txt,.parquet,.pq,.json,.ndjson,.jsonl,.gz"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <span className="text-[13px] font-medium">Drop a file, or click to choose</span>
            <span className="mt-1 text-xs text-ink-500 dark:text-ink-400">
              CSV, TSV, Parquet or JSON
            </span>
          </label>

          {files.length > 0 && (
            <ul className="mt-4 space-y-2">
              {files.map((file) => (
                <li
                  key={file.table}
                  className="rounded-lg bg-[var(--surface-sunken)] px-3.5 py-3 text-[13px]"
                >
                  <div className="flex items-baseline gap-2">
                    <code className="font-mono font-semibold">{file.table}</code>
                    <span className="ml-auto text-xs text-ink-500 tabular-nums dark:text-ink-400">
                      {file.rows.toLocaleString()} rows
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-500 dark:text-ink-400">
                    {file.filename} · {humanSize(file.bytes)} · {file.columns.length} columns
                  </p>
                </li>
              ))}
            </ul>
          )}

          {loadWarnings.length > 0 && (
            <ul className="mt-4 space-y-2">
              {loadWarnings.map((warning) => (
                <li key={warning}>
                  <Note tone="warn">{warning}</Note>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 border-t border-[var(--border-card)] pt-3.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            Files are read straight off your disk by the engine in this tab. They are not copied
            anywhere, and closing the page discards everything.
          </p>
        </Panel>

        <div className="min-w-0 space-y-5">
          <Panel
            step={2}
            title="Your query"
            actions={
              <span className="text-xs text-ink-500 dark:text-ink-400">
                Ctrl / ⌘ + Enter to run
              </span>
            }
          >
            <SqlEditor
              apiRef={editor}
              value={sql}
              onChange={editSql}
              dialectId="duckdb"
              placeholderText="SELECT * FROM your_table"
              minHeight="14rem"
              complete
              onRun={run}
              schema={schema}
              defaultTable={defaultTable}
            />
          </Panel>

          <Panel
            step={3}
            tone="primary"
            title="Result"
            description={
              result && elapsed !== null
                ? `${result.totalRows.toLocaleString()} row${result.totalRows === 1 ? '' : 's'} in ${elapsed.toFixed(0)} ms`
                : undefined
            }
            actions={result ? <CopyButton text={resultText} label="Copy as TSV" /> : undefined}
          >
            {engine === 'starting' && (
              <Note>
                Starting the engine. It is a one-time 7.7 MB download, then it is cached and
                everything after this is instant.
              </Note>
            )}

            {engine === 'failed' && (
              <Note tone="error">
                The engine could not start: {engineError}. It needs WebAssembly and web workers,
                both of which some locked-down browser profiles disable.
              </Note>
            )}

            {queryError && engine !== 'failed' && <Note tone="error">{queryError}</Note>}

            {!result && !queryError && engine !== 'starting' && (
              <Note>Run a query and the rows appear here.</Note>
            )}

            {result && !queryError && <ResultTable result={result} />}
          </Panel>
        </div>
      </div>

      <Panel title="What this is, and what it is not">
        <div className="grid gap-x-10 gap-y-4 text-[13px] leading-relaxed text-ink-600 sm:grid-cols-2 dark:text-ink-300">
          <p>
            This is DuckDB, not your warehouse. Its SQL is close to PostgreSQL, so Athena, T-SQL
            and Oracle specifics will not run here — use it to check that logic is right against
            sample rows, then take the query to the engine it belongs to.
          </p>
          <p>
            Nothing is uploaded, and that is checkable rather than promised. The engine itself is
            served from this same origin, so even loading it makes no request to anyone else. Watch
            the network tab while you drop a file: it stays silent.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function EngineBadge({ state }: { state: EngineState }) {
  const map = {
    idle: { dot: 'bg-ink-400', label: 'Engine not started' },
    starting: { dot: 'bg-amber-500 animate-pulse', label: 'Starting the engine…' },
    ready: { dot: 'bg-emerald-500', label: 'Engine running in this tab' },
    failed: { dot: 'bg-red-500', label: 'Engine unavailable' },
  }[state];

  return (
    <span className="flex items-center gap-2 font-mono text-xs text-ink-500 dark:text-ink-400">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function ResultTable({ result }: { result: QueryShape }) {
  if (result.columns.length === 0) {
    return <Note tone="success">Statement ran. It returned no columns.</Note>;
  }

  return (
    <div>
      <div
        className="overflow-auto rounded-lg border"
        style={{ borderColor: 'var(--code-border)', background: 'var(--code-surface)', maxHeight: '26rem' }}
      >
        <table className="w-full border-collapse font-mono text-[12.5px]">
          <thead className="sticky top-0 z-20">
            <tr>
              {/* The row number column pins left, so it stays readable while a wide
                  result is scrolled sideways — which is when knowing which row you
                  are looking at matters most. */}
              <th
                scope="col"
                className="sticky left-0 z-10 px-3 py-2 text-right font-normal select-none"
                style={{ background: 'var(--code-header)', color: 'var(--syn-comment)' }}
              >
                #
              </th>
              {result.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                  style={{ background: 'var(--code-header)', color: 'var(--syn-plain)' }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--code-border)' }}>
                <td
                  className="sticky left-0 px-3 py-1.5 text-right tabular-nums select-none"
                  style={{
                    background: 'var(--code-surface)',
                    color: 'var(--syn-comment)',
                    borderRight: '1px solid var(--code-border)',
                  }}
                >
                  {i + 1}
                </td>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="px-3 py-1.5 whitespace-nowrap"
                    style={{
                      color: isNullCell(cell) ? 'var(--syn-comment)' : 'var(--syn-plain)',
                      fontStyle: isNullCell(cell) ? 'italic' : undefined,
                    }}
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.rows.length === 0 && (
        <p className="mt-3 text-[13px] text-ink-500 dark:text-ink-400">
          No rows matched.
        </p>
      )}

      {result.truncated && (
        <p className="mt-3 text-xs text-ink-500 dark:text-ink-400">
          Showing the first {MAX_DISPLAY_ROWS.toLocaleString()} of{' '}
          {result.totalRows.toLocaleString()} rows, and copying gives you those same{' '}
          {MAX_DISPLAY_ROWS.toLocaleString()}. Rendering them all would lock the tab. Narrow the
          query with a filter, an aggregate or a LIMIT to see the rest.
        </p>
      )}
    </div>
  );
}
