'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { SqlEditor, type SqlEditorApi } from '@/components/SqlEditor';
import { Button, CopyButton, Note, Panel } from '@/components/ui';
import { ToolHeader } from '@/components/ToolHeader';
import { PlanIcon, PlayIcon, UploadIcon } from '@/components/icons';
import { QueryPlanView } from '@/components/QueryPlanView';
import { getDialect } from '@/lib/dialects';
import { explainSql, isExplainable } from '@/lib/plan';
import { reviewSql, type ReviewFinding } from '@/lib/review';
import {
  completionSchema,
  csvHeaderWarning,
  defaultCompletionTable,
  csvSniffWarning,
  fileKind,
  formatCell,
  humanSize,
  isNullCell,
  MAX_DISPLAY_ROWS,
  referencedTable,
  shapeResult,
  tableNameFor,
  toCsv,
  toTsv,
  type QueryShape,
} from '@/lib/scratchpad';

const STARTER = `-- Drop a CSV or Parquet file on the left, then query it.
SELECT 'ready' AS status, current_date AS today`;

interface LoadedFile {
  table: string;
  filename: string;
  bytes: number;
  rows: number;
  columns: string[];
}

type EngineState = 'idle' | 'starting' | 'ready' | 'failed';

const DESCRIPTION = 'Query a CSV, Parquet or JSON file with real SQL. The engine runs inside this tab, so the file is never uploaded.';

/**
 * The scratchpad, at its own address or at another tool's that is built on it — the
 * query plan visualizer opens the same tool with a query worth explaining.
 */
export function SqlScratchpadTool({
  href = '/scratchpad/',
  description = DESCRIPTION,
  starter = STARTER,
}: { href?: string; description?: string; starter?: string } = {}) {
  const [sql, setSql] = useState(starter);
  const [engine, setEngine] = useState<EngineState>('idle');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [result, setResult] = useState<QueryShape | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
  const [plan, setPlan] = useState<{ json: string; findings: ReviewFinding[] } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

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

  /**
   * The statement that produced the result currently on screen.
   *
   * The export must re-run this, not whatever the editor holds now. Reading the live
   * document instead means editing the query without re-running it and then hitting
   * Download hands back a file for a query that was never run, while the table on
   * screen still shows the old one.
   */
  const ranSql = useRef<string | null>(null);
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
        const { loadTable, registerFile, registerUtf8Copy, runQuery } = await import('@/lib/duckdb');
        const instance = db.current;
        if (!instance) throw new Error('The engine is not running.');

        const loaded: LoadedFile[] = [];
        const rejected: string[] = [];
        const warnings: string[] = [];
        const taken = new Set(files.map((f) => f.table));

        // Each file is loaded on its own. One that fails is reported and the rest carry
        // on — before, the first failure abandoned the batch, and files already loaded
        // became tables that were queryable but missing from the list.
        for (const file of list) {
          const kind = fileKind(file.name);
          if (kind === 'unsupported') {
            rejected.push(file.name);
            continue;
          }
          const table = tableNameFor(file.name, taken);

          try {
            await registerFile(instance, file.name, file);
            const notes = await loadTable(connected, table, file.name, kind, () =>
              registerUtf8Copy(instance, file.name, file),
            );

            const counted = await runQuery(connected, `SELECT count(*) FROM "${table}"`);
            const described = await runQuery(connected, `DESCRIBE "${table}"`);

            const columns = described.rows.map((row) => String(row[0]));
            const sniff = csvSniffWarning(kind, columns) ?? csvHeaderWarning(kind, columns);
            if (sniff) warnings.push(`${file.name}: ${sniff}`);
            for (const note of notes) warnings.push(`${file.name}: ${note}`);

            taken.add(table);
            loaded.push({
              table,
              filename: file.name,
              bytes: file.size,
              rows: Number(counted.rows[0]?.[0] ?? 0),
              columns,
            });
          } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            warnings.push(`Could not load ${file.name}: ${text.split('\n')[0]}`);
          }
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
      const { runForDisplay } = await import('@/lib/duckdb');
      const outcome = await runForDisplay(connected, current);
      ranSql.current = current;
      setResult(shapeResult(outcome.columns, outcome.rows, outcome.totalRows));
      setElapsed(outcome.elapsedMs);
    } catch (error) {
      ranSql.current = null;
      setResult(null);
      setElapsed(null);
      setQueryError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [connection]);

  /**
   * Run the query once with the engine's profiler on, and keep the plan it reports:
   * every step, the rows it produced and the time it took. Only for a query that
   * reads — profiling executes the statement, and an UPDATE would really update.
   */
  const explain = useCallback(async () => {
    const current = editor.current?.getText() ?? sqlRef.current;
    if (current.trim() === '') return;
    setPlanError(null);
    if (!isExplainable(current, getDialect('duckdb'))) {
      setPlan(null);
      setPlanError('Only a single query that reads can be explained. The plan is measured by running it, and a statement that changes data would really change it.');
      return;
    }
    setExplaining(true);
    try {
      const connected = await connection();
      const { runQuery } = await import('@/lib/duckdb');
      const outcome = await runQuery(connected, explainSql(current));
      const json = String(outcome.rows[0]?.[outcome.rows[0].length - 1] ?? '');
      setPlan({ json, findings: reviewSql(current, getDialect('duckdb')) });
    } catch (error) {
      setPlan(null);
      setPlanError(error instanceof Error ? error.message : String(error));
    } finally {
      setExplaining(false);
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

  /**
   * Save the result as CSV.
   *
   * Asks DuckDB to write it, so the file holds every row rather than the 500 on
   * screen. COPY can only wrap a single query, so a statement it refuses — several
   * statements at once, or something that is not a SELECT — falls back to building
   * the file from the rows in hand, and says so rather than quietly handing over a
   * truncated file.
   */
  const downloadCsv = useCallback(async () => {
    if (!result || !ranSql.current) return;
    setBusy(true);
    try {
      let text: string | Uint8Array<ArrayBuffer>;
      let capped = false;
      try {
        const connected = await connection();
        const instance = db.current;
        if (!instance) throw new Error('The engine is not running.');
        const { exportCsv } = await import('@/lib/duckdb');
        text = await exportCsv(instance, connected, ranSql.current);
      } catch {
        text = toCsv(result.columns, result.rows);
        capped = result.truncated;
      }

      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'query-result.csv';
      link.click();
      URL.revokeObjectURL(url);

      setLoadWarnings(
        capped
          ? [
              `The engine could not write the file for this statement, so the download holds the ${result.rows.length.toLocaleString()} rows on screen rather than all ${result.totalRows.toLocaleString()}. Wrap it in a single SELECT to get the lot.`,
            ]
          : [],
      );
    } finally {
      setBusy(false);
    }
  }, [connection, result]);

  // What the editor should suggest: only tables that are actually loaded.
  const schema = useMemo(() => completionSchema(files), [files]);
  const defaultTable = useMemo(
    () => defaultCompletionTable(files) ?? referencedTable(sql, files),
    [files, sql],
  );

  return (
    <div className="space-y-5">
      <ToolHeader
        href={href}
        description={description}
        status={
          <>
            <EngineBadge state={engine} />
            <Button
              icon={<PlanIcon />}
              onClick={() => void explain()}
              disabled={explaining || busy || sql.trim() === ''}
              title="Run the query once and show how the engine executed it"
            >
              {explaining ? 'Explaining…' : 'Explain'}
            </Button>
            <Button
              variant="primary"
              icon={<PlayIcon />}
              onClick={run}
              disabled={busy || sql.trim() === ''}
              title="Run the query (Ctrl+Enter)"
            >
              {busy ? 'Working…' : 'Run'}
            </Button>
          </>
        }
      />

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
                : 'border-[var(--border-strong)] bg-[var(--surface-sunken)] hover:border-accent-500 hover:bg-accent-500/[0.04]'
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
            <span
              className={`mb-3 flex size-10 items-center justify-center rounded-xl border transition-colors ${
                dragging
                  ? 'border-accent-500/40 bg-accent-500/15 text-accent-600 dark:text-accent-400'
                  : 'border-[var(--border-card)] bg-[var(--surface-card)] text-ink-500 shadow-[var(--shadow-control)] dark:text-ink-400'
              }`}
            >
              <UploadIcon className="size-5" />
            </span>
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
                  className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-header)] px-3.5 py-3 text-[13px]"
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
            actions={
              result ? (
                <>
                  <Button onClick={() => void downloadCsv()} disabled={busy}>
                    Download CSV
                  </Button>
                  <CopyButton text={resultText} label="Copy as TSV" />
                </>
              ) : undefined
            }
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

          {(plan || planError) && (
            <Panel
              step={4}
              title="Query plan"
              description="How the engine ran this query, step by step, measured by running it once."
            >
              {planError ? <Note tone={plan ? 'error' : 'warn'}>{planError}</Note> : plan && <QueryPlanView json={plan.json} findings={plan.findings} />}
            </Panel>
          )}
        </div>
      </div>

      <Panel title="What this is, and what it is not">
        <div className="grid gap-x-10 gap-y-4 text-[13px] leading-relaxed text-ink-600 sm:grid-cols-2 dark:text-ink-300">
          <p>
            This is an engine in your browser, not your warehouse. Its SQL is close to PostgreSQL, so Athena, T-SQL
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
    <span className="flex h-8 items-center gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-3 font-mono text-xs text-ink-600 shadow-[var(--shadow-control)] dark:text-ink-300">
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
