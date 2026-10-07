'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import packageJson from '@/package.json';
import {
  assess,
  autoPair,
  DEFAULT_OPTIONS,
  pickKey,
  SOURCE_TABLE,
  TARGET_TABLE,
  uniquenessQuery,
  type Assessment,
  type ColumnInfo,
  type ColumnOutcome,
  type ColumnPair,
  type ParityOptions,
  type ParityResult,
  type ParitySpec,
} from '@/lib/parity';
import { runParity, toCount } from '@/lib/parity-run';
import { exampleFiles, sha256File } from '@/lib/parity-example';
import {
  humanBytes,
  reportFilename,
  reportHtml,
  reportMarkdown,
  VERDICT_TEXT,
  type ParityReport,
  type ReportInput,
} from '@/lib/parity-report';
import { fileKind } from '@/lib/scratchpad';
import { Sql } from '@/components/Sql';
import { ToolHeader } from '@/components/ToolHeader';
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  DownloadIcon,
  KeyIcon,
  NotEqualIcon,
  ParityIcon,
  PlayIcon,
  ReportIcon,
  ShieldIcon,
  SparkIcon,
  UploadIcon,
} from '@/components/icons';
import { Button, CopyButton, Disclosure, Field, Note, Panel, TextInput, Toggle } from '@/components/ui';

type SideId = 'source' | 'target';

interface LoadedSide {
  file: File;
  /** Name the file is registered under in DuckDB; changes on every load. */
  registered: string;
  columns: ColumnInfo[];
  rows: number;
  /** undefined while hashing, null when the file was too large to hash. */
  sha256: string | null | undefined;
  notes: string[];
}

interface Outcome {
  result: ParityResult;
  assessment: Assessment;
  spec: ParitySpec;
  inputs: [ReportInput, ReportInput];
  generatedAt: Date;
  /** The settings this outcome was produced with, to notice when they change. */
  planKey: string;
}

type EngineState = 'idle' | 'starting' | 'ready' | 'failed';

const SIDE_TEXT: Record<SideId, { title: string; description: string; drop: string }> = {
  source: { title: 'Source', description: 'The copy you trust.', drop: 'Drop the source file' },
  target: { title: 'Target', description: 'The copy you are checking.', drop: 'Drop the target file' },
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ParityRunTool() {
  const [sides, setSides] = useState<Record<SideId, LoadedSide | null>>({ source: null, target: null });
  const [loading, setLoading] = useState<Record<SideId, boolean>>({ source: false, target: false });
  const [loadErrors, setLoadErrors] = useState<Record<SideId, string | null>>({ source: null, target: null });
  const [engine, setEngine] = useState<EngineState>('idle');

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<string[]>([]);
  const [suggestedKey, setSuggestedKey] = useState<string | null>(null);
  const [options, setOptions] = useState<ParityOptions>(DEFAULT_OPTIONS);

  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const db = useRef<AsyncDuckDB | null>(null);
  const conn = useRef<AsyncDuckDBConnection | null>(null);

  useEffect(() => () => void conn.current?.close(), []);

  /** Start DuckDB on first use. It is shared with the scratchpad, but this tool has its own connection. */
  const connection = useCallback(async (): Promise<AsyncDuckDBConnection> => {
    if (conn.current) return conn.current;
    setEngine('starting');
    try {
      const { getDuckDb } = await import('@/lib/duckdb');
      const instance = await getDuckDb();
      db.current = instance;
      conn.current = await instance.connect();
      setEngine('ready');
      return conn.current;
    } catch (error) {
      setEngine('failed');
      throw error;
    }
  }, []);

  const loadSide = useCallback(
    async (side: SideId, file: File) => {
      setLoading((l) => ({ ...l, [side]: true }));
      setLoadErrors((e) => ({ ...e, [side]: null }));
      try {
        const kind = fileKind(file.name);
        if (kind === 'unsupported') {
          throw new Error(`${file.name} is not a file Parity Run can read. Use CSV, TSV, Parquet or JSON.`);
        }
        const c = await connection();
        const { loadTable, registerFile, registerUtf8Copy, runQuery } = await import('@/lib/duckdb');
        const registered = `parity-${side}-${Date.now()}-${file.name}`;
        await registerFile(db.current!, registered, file);
        const table = side === 'source' ? SOURCE_TABLE : TARGET_TABLE;
        const notes = await loadTable(c, table, registered, kind, () =>
          registerUtf8Copy(db.current!, registered, file),
        );
        const described = await runQuery(c, `DESCRIBE ${table}`);
        const columns = described.rows.map((r) => ({ name: String(r[0]), type: String(r[1]) }));
        const count = await runQuery(c, `SELECT count(*) FROM ${table}`);

        setSides((prev) => ({
          ...prev,
          [side]: { file, registered, columns, rows: toCount(count.rows[0]?.[0]), sha256: undefined, notes },
        }));
        // The fingerprint is for the report; the comparison does not wait for it.
        void sha256File(file)
          .catch(() => null)
          .then((sha256) =>
            setSides((prev) => {
              const current = prev[side];
              return current && current.file === file ? { ...prev, [side]: { ...current, sha256 } } : prev;
            }),
          );
      } catch (error) {
        setLoadErrors((e) => ({ ...e, [side]: message(error) }));
      } finally {
        setLoading((l) => ({ ...l, [side]: false }));
      }
    },
    [connection],
  );

  const loadExample = useCallback(async () => {
    const files = exampleFiles();
    await loadSide('source', files.source);
    await loadSide('target', files.target);
  }, [loadSide]);

  // "Try it with example data" links elsewhere point at #example. Load it, then drop
  // the fragment so a refresh or a shared URL does not quietly replace real files.
  useEffect(() => {
    const check = () => {
      if (window.location.hash !== '#example') return;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      void loadExample();
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [loadExample]);

  // Pair the columns and suggest a key whenever either file changes.
  const source = sides.source;
  const target = sides.target;
  useEffect(() => {
    if (!source || !target) return;
    const { pairs } = autoPair(source.columns, target.columns);
    setMapping(Object.fromEntries(source.columns.map((c) => [c.name, pairs.find((p) => p.source === c.name)?.target ?? ''])));
    setIncluded(Object.fromEntries(source.columns.map((c) => [c.name, true])));
    setOutcome(null);
    setRunError(null);

    let cancelled = false;
    void (async () => {
      try {
        const c = await connection();
        const { runQuery } = await import('@/lib/duckdb');
        const names = pairs.map((p) => p.source);
        const row = (await runQuery(c, uniquenessQuery(SOURCE_TABLE, names))).rows[0] ?? [];
        const total = toCount(row[0]);
        const unique = new Set(
          names.filter((_, i) => total > 0 && toCount(row[1 + i * 2]) === total && toCount(row[2 + i * 2]) === total),
        );
        const key = pickKey(pairs, unique);
        if (cancelled) return;
        setSuggestedKey(key?.source ?? null);
        setKeys(key ? [key.source] : []);
      } catch {
        if (!cancelled) {
          setSuggestedKey(null);
          setKeys([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-pair only when a file is replaced, not on every fingerprint update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.registered, target?.registered, connection]);

  const plan = useMemo(() => {
    if (!source || !target) return null;
    const targetByName = new Map(target.columns.map((c) => [c.name, c]));
    const pairs: ColumnPair[] = source.columns.flatMap((c) => {
      const t = mapping[c.name] ? targetByName.get(mapping[c.name]!) : undefined;
      return t ? [{ source: c.name, target: t.name, sourceType: c.type, targetType: t.type }] : [];
    });
    const keyPairs = pairs.filter((p) => keys.includes(p.source));
    const compare = pairs.filter((p) => !keys.includes(p.source) && included[p.source] !== false);
    const excluded = pairs.filter((p) => !keys.includes(p.source) && included[p.source] === false).map((p) => p.source);
    const used = new Set(pairs.map((p) => p.target));
    const spec: ParitySpec = { keys: keyPairs, compare, options };
    return {
      spec,
      pairs,
      excluded,
      unpairedSource: source.columns.filter((c) => !pairs.some((p) => p.source === c.name)).map((c) => c.name),
      unpairedTarget: target.columns.filter((c) => !used.has(c.name)).map((c) => c.name),
      key: JSON.stringify([source.registered, target.registered, spec]),
    };
  }, [source, target, mapping, included, keys, options]);

  const run = useCallback(async () => {
    if (!plan || !source || !target) return;
    setRunError(null);
    setProgress('Starting');
    try {
      const c = await connection();
      const { runQuery } = await import('@/lib/duckdb');
      const version = String((await runQuery(c, 'SELECT version()')).rows[0]?.[0] ?? '');
      const result = await runParity(
        (sql) => runQuery(c, sql),
        plan.spec,
        {
          unpairedSource: plan.unpairedSource,
          unpairedTarget: plan.unpairedTarget,
          excluded: plan.excluded,
          // Kept for the report's machine-readable block, where it makes a run
          // reproducible; the page itself does not name the engine.
          engineVersion: `DuckDB ${version}`,
        },
        setProgress,
      );
      const input = (side: SideId, s: LoadedSide): ReportInput => ({
        side,
        name: s.file.name,
        bytes: s.file.size,
        rows: s.rows,
        columns: s.columns.length,
        sha256: s.sha256 ?? null,
        notes: s.notes,
      });
      setOutcome({
        result,
        assessment: assess(result, plan.spec.options),
        spec: plan.spec,
        inputs: [input('source', source), input('target', target)],
        generatedAt: new Date(),
        planKey: plan.key,
      });
    } catch (error) {
      setRunError(message(error));
    } finally {
      setProgress(null);
    }
  }, [plan, source, target, connection]);

  // Fingerprints usually finish after the run; fold them into the outcome when they do.
  useEffect(() => {
    if (!outcome || !source || !target) return;
    const [s, t] = outcome.inputs;
    if (s.sha256 === (source.sha256 ?? null) && t.sha256 === (target.sha256 ?? null)) return;
    setOutcome({
      ...outcome,
      inputs: [
        { ...s, sha256: source.sha256 ?? null },
        { ...t, sha256: target.sha256 ?? null },
      ],
    });
  }, [outcome, source, target]);

  const stale = outcome && plan && outcome.planKey !== plan.key;
  const signState: SignState = progress
    ? 'running'
    : outcome && !stale
      ? outcome.assessment.verdict
      : source && target
        ? 'ready'
        : 'waiting';

  return (
    <div className="space-y-5">
      <ToolHeader
        href="/parity-run/"
        description="Drop two copies of a table — before and after a pipeline run, a replica and its primary, last week’s export and today’s. Parity Run lines up every row, counts every difference, and writes a sign-off report — all inside this tab."
        status={
          <>
            <EngineBadge state={engine} />
            <Button icon={<SparkIcon />} onClick={() => void loadExample()} disabled={loading.source || loading.target}>
              Try the example
            </Button>
          </>
        }
      />

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-3">
        {/* Source, sign, target in reading order, so on a phone the sign sits between
            the two files it compares rather than after both. */}
        <SideSlot
          side="source"
          loaded={sides.source}
          busy={loading.source}
          error={loadErrors.source}
          onFile={(file) => void loadSide('source', file)}
        />
        <div className="flex items-center justify-center">
          <ParitySign state={signState} />
        </div>
        <SideSlot
          side="target"
          loaded={sides.target}
          busy={loading.target}
          error={loadErrors.target}
          onFile={(file) => void loadSide('target', file)}
        />
      </div>

      {plan && source && target && (
        <Panel
          step={3}
          title="Line them up"
          description="Choose the key rows are matched on, and which columns must hold the same values."
        >
          <MatchSettings
            pairs={plan.pairs}
            sourceColumns={source.columns}
            targetColumns={target.columns}
            mapping={mapping}
            setMapping={setMapping}
            included={included}
            setIncluded={setIncluded}
            keys={keys}
            setKeys={setKeys}
            suggestedKey={suggestedKey}
            options={options}
            setOptions={setOptions}
            unpairedTarget={plan.unpairedTarget}
          />

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[var(--border-card)] pt-5">
            <button
              type="button"
              onClick={() => void run()}
              disabled={!!progress || (plan.spec.keys.length === 0 && plan.spec.compare.length === 0)}
              className="inline-flex h-11 items-center gap-2.5 rounded-xl bg-gradient-to-b from-accent-500 to-accent-600 px-5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_8px_20px_-8px_oklch(0.55_0.18_250/0.75),0_0_0_1px_oklch(0.46_0.16_250)] transition-all hover:from-accent-600 hover:to-accent-700 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
            >
              <PlayIcon className="size-4" />
              {progress ? `${progress}…` : outcome && !stale ? 'Run again' : 'Run parity check'}
            </button>
            <p className="text-[13px] text-ink-500 dark:text-ink-400">
              {plan.spec.keys.length > 0
                ? `Matching on ${plan.spec.keys.map((k) => k.source).join(' + ')}, comparing ${plan.spec.compare.length} column${plan.spec.compare.length === 1 ? '' : 's'}.`
                : `No key — comparing whole rows across ${plan.spec.compare.length} column${plan.spec.compare.length === 1 ? '' : 's'}.`}
            </p>
          </div>
          {runError && (
            <div className="mt-4">
              <Note tone="error">The check could not finish: {runError}</Note>
            </div>
          )}
        </Panel>
      )}

      {outcome && (
        <Results outcome={outcome} stale={!!stale} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the sign */

type SignState = 'waiting' | 'ready' | 'running' | 'match' | 'match-with-gaps' | 'differs';

/**
 * The parity sign between the two files: the product's mark, carrying the answer.
 *
 * It starts dashed and grey, solidifies when both files are in, and turns green for a
 * match, amber for a match with gaps and red — struck through — when the data differs.
 */
function ParitySign({ state }: { state: SignState }) {
  const tone = {
    waiting: 'border-dashed border-[var(--border-strong)] bg-[var(--surface-card)] text-ink-300 dark:text-ink-600',
    ready: 'border-[var(--border-strong)] bg-[var(--surface-card)] text-ink-500 dark:text-ink-300',
    running: 'border-accent-500/60 bg-[var(--surface-card)] text-accent-600 dark:text-accent-400',
    match: 'border-transparent bg-[var(--signal)] text-white shadow-[0_10px_28px_-8px_var(--signal)]',
    'match-with-gaps': 'border-transparent bg-amber-500 text-white shadow-[0_10px_28px_-8px_oklch(0.75_0.16_75)]',
    differs: 'border-transparent bg-red-500 text-white shadow-[0_10px_28px_-8px_oklch(0.63_0.22_25)]',
  }[state];
  const label = {
    waiting: 'Waiting for both files',
    ready: 'Ready to compare',
    running: 'Comparing',
    match: 'The two files match',
    'match-with-gaps': 'Match on the compared columns',
    differs: 'The two files differ',
  }[state];

  return (
    <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
      <span
        className={`relative flex size-14 items-center justify-center rounded-full border-2 transition-all duration-300 lg:size-16 ${tone}`}
        title={label}
      >
        {state === 'running' && (
          <span
            aria-hidden="true"
            className="absolute -inset-[2px] animate-spin rounded-full border-2 border-transparent border-t-accent-500"
          />
        )}
        {state === 'differs' ? <NotEqualIcon className="size-7" /> : (
          <svg viewBox="0 0 20 20" aria-hidden="true" className="size-7" fill="currentColor">
            <rect x="4" y="6.2" width="12" height="2.4" rx="1.2" />
            <rect x="4" y="11.4" width="12" height="2.4" rx="1.2" />
          </svg>
        )}
      </span>
      <span className="text-center text-[11.5px] font-medium text-ink-500 lg:max-w-20 dark:text-ink-400">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------ file slots */

function SideSlot({
  side,
  loaded,
  busy,
  error,
  onFile,
}: {
  side: SideId;
  loaded: LoadedSide | null;
  busy: boolean;
  error: string | null;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const text = SIDE_TEXT[side];

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept=".csv,.tsv,.txt,.parquet,.pq,.json,.ndjson,.jsonl,.gz"
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
        e.target.value = '';
      }}
    />
  );

  return (
    <div>
      <Panel
        step={side === 'source' ? 1 : 2}
        title={text.title}
        description={text.description}
        className="h-full"
        actions={
          loaded ? (
            <Button variant="ghost" icon={<UploadIcon />} onClick={() => input.current?.click()} disabled={busy}>
              Replace
            </Button>
          ) : undefined
        }
      >
        {fileInput}
        {loaded && !busy ? (
          <LoadedFileCard side={loaded} />
        ) : (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) onFile(file);
            }}
            onClick={(e) => {
              e.preventDefault();
              input.current?.click();
            }}
            className={`flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragging
                ? 'border-accent-500 bg-accent-500/10'
                : 'border-[var(--border-strong)] bg-[var(--surface-sunken)] hover:border-accent-500 hover:bg-accent-500/[0.04]'
            }`}
          >
            <span
              className={`mb-3.5 flex size-12 items-center justify-center rounded-2xl border shadow-[var(--shadow-control)] ${
                dragging || busy
                  ? 'border-accent-500/40 bg-accent-500/15 text-accent-600 dark:text-accent-400'
                  : 'border-[var(--border-card)] bg-[var(--surface-card)] text-ink-500 dark:text-ink-400'
              }`}
            >
              {busy ? (
                <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <UploadIcon className="size-6" />
              )}
            </span>
            <span className="text-[14.5px] font-semibold">{busy ? 'Reading the file…' : text.drop}</span>
            <span className="mt-1 text-[12.5px] text-ink-500 dark:text-ink-400">
              CSV, TSV, Parquet or JSON — read in this tab, never uploaded
            </span>
          </label>
        )}
        {error && (
          <div className="mt-3">
            <Note tone="error">{error}</Note>
          </div>
        )}
      </Panel>
    </div>
  );
}

function LoadedFileCard({ side }: { side: LoadedSide }) {
  const shown = side.columns.slice(0, 12);
  const kind = fileKind(side.file.name);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border font-mono text-[10.5px] font-semibold uppercase"
          style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-string)' }}
        >
          {kind === 'parquet' ? 'PQ' : kind === 'json' ? 'JSON' : 'CSV'}
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-[14px] font-semibold" title={side.file.name}>
            {side.file.name}
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-500 dark:text-ink-400">{humanBytes(side.file.size)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2.5">
        <MiniStat label="Rows" value={side.rows.toLocaleString('en-US')} />
        <MiniStat label="Columns" value={side.columns.length.toLocaleString('en-US')} />
      </dl>

      <div className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-header)] px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12px] font-medium text-ink-600 dark:text-ink-300">
          <ShieldIcon className="size-3.5 text-[var(--signal)]" />
          SHA-256 fingerprint
        </div>
        <p className="mt-1 font-mono text-[11.5px] break-all text-ink-500 dark:text-ink-400">
          {side.sha256 === undefined ? 'Computing…' : side.sha256 === null ? 'Too large to fingerprint in a tab' : side.sha256}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <span
            key={c.name}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-card)] bg-[var(--surface-card)] px-2 py-0.5 font-mono text-[11.5px]"
          >
            {c.name}
            <span className="text-ink-400 dark:text-ink-500">{c.type.toLowerCase()}</span>
          </span>
        ))}
        {side.columns.length > shown.length && (
          <span className="px-1 text-[12px] text-ink-500 dark:text-ink-400">+{side.columns.length - shown.length} more</span>
        )}
      </div>

      {side.notes.map((note) => (
        <Note key={note} tone="info">
          {note}
        </Note>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-card)] px-3 py-2">
      <dt className="text-[11.5px] font-medium text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="mt-0.5 font-mono text-[17px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/* ----------------------------------------------------------- the settings */

function MatchSettings({
  pairs,
  sourceColumns,
  targetColumns,
  mapping,
  setMapping,
  included,
  setIncluded,
  keys,
  setKeys,
  suggestedKey,
  options,
  setOptions,
  unpairedTarget,
}: {
  pairs: ColumnPair[];
  sourceColumns: ColumnInfo[];
  targetColumns: ColumnInfo[];
  mapping: Record<string, string>;
  setMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  included: Record<string, boolean>;
  setIncluded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  keys: string[];
  setKeys: React.Dispatch<React.SetStateAction<string[]>>;
  suggestedKey: string | null;
  options: ParityOptions;
  setOptions: React.Dispatch<React.SetStateAction<ParityOptions>>;
  unpairedTarget: string[];
}) {
  const targetType = new Map(targetColumns.map((c) => [c.name, c.type]));
  // Functional updates throughout: two quick clicks must both land, not the last one only.
  const toggleKey = (name: string) =>
    setKeys((prev) => (prev.includes(name) ? prev.filter((k) => k !== name) : [...prev, name]));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <KeyIcon className="size-4 text-accent-600 dark:text-accent-400" />
          Match rows on
        </h3>
        <p className="mt-1 text-[12.5px] text-ink-500 dark:text-ink-400">
          Pick the column, or columns, that identify a row. With no key, each side is compared as a whole set of rows.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {pairs.map((p) => {
            const active = keys.includes(p.source);
            return (
              <button
                key={p.source}
                type="button"
                aria-pressed={active}
                onClick={() => toggleKey(p.source)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 font-mono text-[12.5px] transition-colors ${
                  active
                    ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300'
                    : 'border-[var(--border-card)] bg-[var(--surface-card)] text-ink-600 hover:border-[var(--border-strong)] dark:text-ink-300'
                }`}
              >
                {active && <CheckIcon className="size-3.5" />}
                {p.source}
                {p.source === suggestedKey && (
                  <span className="rounded bg-[var(--signal-soft)] px-1.5 py-px font-sans text-[10.5px] font-medium text-[color-mix(in_oklab,var(--signal)_70%,black)] dark:text-[var(--signal)]">
                    unique
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold">Columns to compare</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border-card)]">
          <table className="w-full min-w-[34rem] border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-header)] text-left text-[12px] text-ink-500 dark:text-ink-400">
                <th className="w-10 px-3 py-2 font-medium">
                  <span className="sr-only">Compare</span>
                </th>
                <th className="px-3 py-2 font-medium">Source column</th>
                <th className="px-3 py-2 font-medium">Target column</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sourceColumns.map((c) => {
                const mapped = mapping[c.name] ?? '';
                const isKey = keys.includes(c.name);
                const on = included[c.name] !== false;
                const tType = mapped ? targetType.get(mapped) : undefined;
                return (
                  <tr key={c.name} className="border-t border-[var(--border-card)]">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Compare ${c.name}`}
                        checked={!!mapped && (isKey || on)}
                        disabled={!mapped || isKey}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setIncluded((prev) => ({ ...prev, [c.name]: checked }));
                        }}
                        className="size-4 accent-[var(--color-accent-600)]"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono">{c.name}</span>
                      <span className="ml-2 font-mono text-[11.5px] text-ink-400">{c.type.toLowerCase()}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={mapped}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMapping((prev) => ({ ...prev, [c.name]: value }));
                        }}
                        aria-label={`Target column for ${c.name}`}
                        className="h-8 w-full max-w-60 rounded-md border border-[var(--border-card)] bg-[var(--surface-card)] px-2 font-mono text-[12.5px] outline-none focus:border-accent-500"
                      >
                        <option value="">Not in the target</option>
                        {targetColumns.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill
                        tone={isKey ? 'key' : !mapped ? 'muted' : !on ? 'muted' : tType && tType !== c.type ? 'warn' : 'ok'}
                      >
                        {isKey
                          ? 'Key'
                          : !mapped
                            ? 'Not compared'
                            : !on
                              ? 'Left out'
                              : tType && tType !== c.type
                                ? `Type ${c.type.toLowerCase()} → ${tType.toLowerCase()}`
                                : 'Compared'}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unpairedTarget.length > 0 && (
          <p className="mt-2 text-[12.5px] text-ink-500 dark:text-ink-400">
            Only in the target, not compared:{' '}
            {unpairedTarget.map((n, i) => (
              <span key={n}>
                <code className="font-mono text-ink-700 dark:text-ink-300">{n}</code>
                {i < unpairedTarget.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-semibold">How strictly</h3>
        <p className="mt-1 text-[12.5px] text-ink-500 dark:text-ink-400">
          Exact by default, with NULL equal to NULL. Each relaxation is recorded in the report.
        </p>
        <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Toggle checked={options.trim} onChange={(v) => setOptions((o) => ({ ...o, trim: v }))} label="Ignore whitespace" hint="Around text values" />
          <Toggle checked={options.ignoreCase} onChange={(v) => setOptions((o) => ({ ...o, ignoreCase: v }))} label="Ignore case" hint="ABC equals abc" />
          <Toggle checked={options.emptyAsNull} onChange={(v) => setOptions((o) => ({ ...o, emptyAsNull: v }))} label="Empty text is NULL" hint="'' equals NULL" />
          <Field label="Number tolerance" hint="0 means exact">
            <input
              type="number"
              min={0}
              step="any"
              value={options.tolerance}
              onChange={(e) => {
                const v = Number(e.target.value);
                setOptions((o) => ({ ...o, tolerance: Number.isFinite(v) && v >= 0 ? v : 0 }));
              }}
              className="h-9 w-full rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-3 font-mono text-sm tabular-nums shadow-[var(--shadow-control)] outline-none focus:border-accent-500 focus:ring-3 focus:ring-accent-500/20"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'key'; children: React.ReactNode }) {
  const style = {
    ok: 'bg-[var(--signal-soft)] text-[color-mix(in_oklab,var(--signal)_70%,black)] dark:text-[var(--signal)]',
    warn: 'bg-amber-500/12 text-amber-800 dark:text-amber-300',
    muted: 'bg-ink-500/10 text-ink-500 dark:text-ink-400',
    key: 'bg-accent-500/12 text-accent-700 dark:text-accent-300',
  }[tone];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${style}`}>{children}</span>;
}

/* --------------------------------------------------------------- results */

function Results({ outcome, stale }: { outcome: Outcome; stale: boolean }) {
  const { result, assessment } = outcome;
  const verdict = VERDICT_TEXT[assessment.verdict];
  const tone = {
    match: {
      ring: 'border-[color-mix(in_oklab,var(--signal)_45%,transparent)]',
      wash: 'from-[var(--signal-soft)]',
      icon: 'bg-[var(--signal)] text-white',
      text: 'text-[color-mix(in_oklab,var(--signal)_70%,black)] dark:text-[var(--signal)]',
    },
    'match-with-gaps': {
      ring: 'border-amber-400/60',
      wash: 'from-amber-500/10',
      icon: 'bg-amber-500 text-white',
      text: 'text-amber-800 dark:text-amber-300',
    },
    differs: {
      ring: 'border-red-400/60',
      wash: 'from-red-500/10',
      icon: 'bg-red-500 text-white',
      text: 'text-red-700 dark:text-red-300',
    },
  }[assessment.verdict];

  const k = result.keys;
  const differingColumns = result.columns.filter((c) => c.mismatches > 0).length;
  const tiles: { label: string; value: number; bad?: boolean }[] = [
    { label: 'Source rows', value: result.sourceRows, bad: result.sourceRows !== result.targetRows },
    { label: 'Target rows', value: result.targetRows, bad: result.sourceRows !== result.targetRows },
    ...(k
      ? [
          { label: 'Keys matched', value: k.matched },
          { label: 'Only in source', value: k.onlySource, bad: k.onlySource > 0 },
          { label: 'Only in target', value: k.onlyTarget, bad: k.onlyTarget > 0 },
        ]
      : [
          { label: 'Rows only in source', value: result.rowSets?.onlySource ?? 0, bad: (result.rowSets?.onlySource ?? 0) > 0 },
          { label: 'Rows only in target', value: result.rowSets?.onlyTarget ?? 0, bad: (result.rowSets?.onlyTarget ?? 0) > 0 },
        ]),
    { label: 'Columns that differ', value: differingColumns, bad: differingColumns > 0 },
  ];

  return (
    <div className={`space-y-5 transition-opacity ${stale ? 'opacity-60' : ''}`}>
      {stale && (
        <Note tone="warn">The settings changed since this run. Run the check again to update the result and the report.</Note>
      )}

      <section
        className={`relative overflow-hidden rounded-2xl border-2 bg-gradient-to-br to-transparent bg-[var(--surface-card)] p-6 shadow-[var(--shadow-card)] sm:p-7 ${tone.ring} ${tone.wash}`}
      >
        <div className="flex flex-wrap items-start gap-5">
          <span className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${tone.icon}`}>
            {assessment.verdict === 'differs' ? <NotEqualIcon className="size-7" /> : <ParityIcon className="size-7" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className={`text-2xl font-semibold tracking-tight sm:text-[28px] ${tone.text}`}>{verdict.label}</h2>
            <p className="mt-1 text-[15px] text-ink-600 dark:text-ink-300">{verdict.line}</p>
            {assessment.findings.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {assessment.findings.map((f) => (
                  <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed">
                    <AlertIcon className="mt-[3px] size-4 shrink-0 text-red-500" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
            {assessment.gaps.length > 0 && (
              <ul className="mt-3 space-y-1">
                {assessment.gaps.map((g) => (
                  <li key={g} className="text-[13px] leading-relaxed text-ink-500 dark:text-ink-400">
                    {g}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="font-mono text-[11.5px] text-ink-500 sm:text-right dark:text-ink-400">
            Computed in this tab
            <br />
            {Math.max(1, Math.round(result.elapsedMs)).toLocaleString('en-US')} ms · {result.queries.length} statements
          </p>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`rounded-xl border bg-[var(--surface-card)] px-4 py-3.5 shadow-[var(--shadow-control)] ${
              t.bad ? 'border-red-300/70 dark:border-red-800/60' : 'border-[var(--border-card)]'
            }`}
          >
            <dt className="text-[12px] font-medium text-ink-500 dark:text-ink-400">{t.label}</dt>
            <dd
              className={`mt-1 font-mono text-[22px] font-semibold tabular-nums ${
                t.bad ? 'text-red-600 dark:text-red-400' : ''
              }`}
            >
              {t.value.toLocaleString('en-US')}
            </dd>
          </div>
        ))}
      </dl>

      {result.columns.length > 0 && <ColumnTable outcome={outcome} />}

      {(result.onlySourceSamples.length > 0 || result.onlyTargetSamples.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          <MissingList
            title={result.mode === 'key' ? 'Keys only in the source' : 'Rows only in the source'}
            rows={result.onlySourceSamples}
            total={k?.onlySource ?? result.rowSets?.onlySource ?? 0}
          />
          <MissingList
            title={result.mode === 'key' ? 'Keys only in the target' : 'Rows only in the target'}
            rows={result.onlyTargetSamples}
            total={k?.onlyTarget ?? result.rowSets?.onlyTarget ?? 0}
          />
        </div>
      )}

      <Disclosure label={`Every statement that ran (${result.queries.length})`} hint="the exact SQL behind each figure">
        <div className="space-y-4">
          {result.queries.map((q, i) => (
            <div key={i}>
              <p className="mb-1.5 text-[12.5px] font-medium text-ink-600 dark:text-ink-300">{q.label}</p>
              <div
                className="code-scroll overflow-x-auto rounded-lg border p-3.5 text-[12.5px] leading-relaxed"
                style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)' }}
              >
                <Sql code={q.sql} dialectId="duckdb" />
              </div>
            </div>
          ))}
        </div>
      </Disclosure>

      <SignOff outcome={outcome} disabled={stale} />
    </div>
  );
}

function ColumnTable({ outcome }: { outcome: Outcome }) {
  const { result } = outcome;
  const [open, setOpen] = useState<string | null>(null);
  const compared = result.keys?.comparedRows ?? 0;
  const keyNames = outcome.spec.keys.map((k) => k.source);

  return (
    <Panel title="Column by column" description={result.mode === 'key' ? `Across ${compared.toLocaleString('en-US')} matched row pairs.` : 'Whole-row comparison: per-column counts need a key.'}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-500 dark:text-ink-400">
              <th className="pb-2 font-medium">Column</th>
              <th className="pb-2 font-medium">Type</th>
              <th className="pb-2 text-right font-medium">Rows that differ</th>
              <th className="w-[32%] pb-2 pl-5 font-medium">Share</th>
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {result.columns.map((c) => (
              <ColumnRow
                key={c.pair.source}
                column={c}
                compared={compared}
                mode={result.mode}
                open={open === c.pair.source}
                onToggle={() => setOpen(open === c.pair.source ? null : c.pair.source)}
                keyNames={keyNames}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ColumnRow({
  column,
  compared,
  mode,
  open,
  onToggle,
  keyNames,
}: {
  column: ColumnOutcome;
  compared: number;
  mode: 'key' | 'rows';
  open: boolean;
  onToggle: () => void;
  keyNames: string[];
}) {
  const share = compared > 0 ? column.mismatches / compared : 0;
  const bad = column.mismatches > 0;
  const types =
    column.pair.sourceType === column.pair.targetType
      ? column.pair.sourceType.toLowerCase()
      : `${column.pair.sourceType.toLowerCase()} → ${column.pair.targetType.toLowerCase()}`;

  return (
    <>
      <tr className="border-t border-[var(--border-card)]">
        <td className="py-2.5 pr-3">
          <span className="font-mono font-medium">{column.pair.source}</span>
          {column.pair.target !== column.pair.source && (
            <span className="font-mono text-ink-400"> → {column.pair.target}</span>
          )}
        </td>
        <td className="py-2.5 pr-3 font-mono text-[12px] text-ink-500 dark:text-ink-400">{types}</td>
        <td className={`py-2.5 text-right font-mono font-semibold tabular-nums ${bad ? 'text-red-600 dark:text-red-400' : 'text-[color-mix(in_oklab,var(--signal)_70%,black)] dark:text-[var(--signal)]'}`}>
          {column.mismatches.toLocaleString('en-US')}
        </td>
        <td className="py-2.5 pl-5">
          {mode === 'key' ? (
            <div className="flex items-center gap-2.5">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-500/12">
                <div
                  className={`h-full rounded-full ${bad ? 'bg-red-500' : 'bg-[var(--signal)]'}`}
                  style={{ width: bad ? `${Math.max(3, share * 100)}%` : '100%', opacity: bad ? 1 : 0.35 }}
                />
              </div>
              <span className="w-14 text-right font-mono text-[11.5px] text-ink-500 tabular-nums dark:text-ink-400">
                {bad ? `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%` : 'match'}
              </span>
            </div>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </td>
        <td className="py-2.5 text-right">
          {column.samples.length > 0 && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={`Examples for ${column.pair.source}`}
              className="inline-flex size-7 items-center justify-center rounded-md text-ink-500 hover:bg-ink-900/[0.06] dark:hover:bg-white/[0.07]"
            >
              <ChevronIcon className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="pb-4">
            <div
              className="code-scroll overflow-x-auto rounded-lg border"
              style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)' }}
            >
              <table className="w-full border-collapse font-mono text-[12.5px]">
                <thead>
                  <tr style={{ background: 'var(--code-header)', color: 'var(--syn-comment)' }}>
                    {keyNames.map((k) => (
                      <th key={k} className="px-3.5 py-2 text-left font-normal">
                        {k}
                      </th>
                    ))}
                    <th className="px-3.5 py-2 text-left font-normal">source</th>
                    <th className="px-3.5 py-2 text-left font-normal">target</th>
                  </tr>
                </thead>
                <tbody>
                  {column.samples.map((s, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--code-border)' }}>
                      {s.key.map((k, j) => (
                        <td key={j} className="px-3.5 py-2" style={{ color: 'var(--syn-number)' }}>
                          {k}
                        </td>
                      ))}
                      <td className="px-3.5 py-2 whitespace-pre" style={{ color: s.source === 'NULL' ? 'var(--syn-comment)' : 'var(--syn-plain)' }}>
                        {s.source}
                      </td>
                      <td className="px-3.5 py-2 whitespace-pre" style={{ color: s.target === 'NULL' ? 'var(--syn-comment)' : 'oklch(0.78 0.14 25)' }}>
                        {s.target}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MissingList({ title, rows, total }: { title: string; rows: string[][]; total: number }) {
  return (
    <Panel title={title} description={total > rows.length ? `First ${rows.length} of ${total.toLocaleString('en-US')}` : `${total.toLocaleString('en-US')} in all`}>
      {rows.length === 0 ? (
        <Note tone="success">None.</Note>
      ) : (
        <div
          className="code-scroll max-h-64 overflow-auto rounded-lg border p-3 font-mono text-[12.5px] leading-relaxed"
          style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-number)' }}
        >
          {rows.map((r, i) => (
            <div key={i} className="whitespace-pre">
              {r.join('  ·  ')}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- sign-off */

function SignOff({ outcome, disabled }: { outcome: Outcome; disabled: boolean }) {
  const [title, setTitle] = useState(`${outcome.inputs[0].name} → ${outcome.inputs[1].name}`);
  const [preparedBy, setPreparedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [includeSamples, setIncludeSamples] = useState(false);

  const report: ParityReport = {
    title,
    preparedBy,
    notes,
    generatedAt: outcome.generatedAt,
    appVersion: packageJson.version,
    inputs: outcome.inputs,
    spec: outcome.spec,
    result: outcome.result,
    assessment: outcome.assessment,
    includeSamples,
  };

  const blobUrl = (html: string) => URL.createObjectURL(new Blob([html], { type: 'text/html' }));

  const download = () => {
    const url = blobUrl(reportHtml(report));
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFilename(report);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const preview = () => {
    const url = blobUrl(reportHtml(report));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const fingerprinted = outcome.inputs.every((i) => i.sha256);
  const verdict = VERDICT_TEXT[outcome.assessment.verdict];

  return (
    <Panel
      step={4}
      tone="primary"
      title="Sign-off report"
      description="One HTML file with the verdict, the file fingerprints, every setting and every statement. It prints cleanly to PDF."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-4">
          <Field label="Title">
            <TextInput value={title} onChange={setTitle} />
          </Field>
          <Field label="Prepared by" hint="Optional. Appears under the title.">
            <TextInput value={preparedBy} onChange={setPreparedBy} placeholder="Name or team" />
          </Field>
          <Field label="Notes" hint="Optional. Context for the reviewer, such as the ticket number.">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-3 py-2 text-sm shadow-[var(--shadow-control)] outline-none focus:border-accent-500 focus:ring-3 focus:ring-accent-500/20"
            />
          </Field>
          <Toggle
            checked={includeSamples}
            onChange={setIncludeSamples}
            label="Include example values"
            hint="Off by default: examples are real rows from your files. With it off, the report carries counts, fingerprints and SQL only."
          />
        </div>

        {/* A miniature of the document, so what will be downloaded is visible first. */}
        <div className="flex flex-col">
          <div className="flex-1 rounded-xl border border-[var(--border-card)] bg-white p-5 text-[#161a26] shadow-[var(--shadow-raised)]">
            <div className="flex items-center gap-2 border-b border-[#dfe3ea] pb-3">
              <ReportIcon className="size-4 text-[#2f6bde]" />
              <span className="text-[11px] font-semibold">SQLParity</span>
              <span className="ml-auto text-[10px] text-[#5b6275]">Parity sign-off report</span>
            </div>
            <p className="mt-3 line-clamp-2 text-[15px] leading-snug font-semibold">{title || 'Parity Run'}</p>
            <p className="mt-0.5 text-[10.5px] text-[#5b6275]">
              {preparedBy ? `Prepared by ${preparedBy}` : 'Generated in the browser'}
            </p>
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-[12px] font-bold ${
                outcome.assessment.verdict === 'match'
                  ? 'border-[#b7e2cf] bg-[#e7f6ef] text-[#0f7a55]'
                  : outcome.assessment.verdict === 'differs'
                    ? 'border-[#f3c3be] bg-[#fdecea] text-[#b42318]'
                    : 'border-[#f0d9a2] bg-[#fdf3dc] text-[#8a5a00]'
              }`}
            >
              {verdict.label}
            </div>
            <div className="mt-3 space-y-1.5">
              {outcome.inputs.map((i) => (
                <div key={i.side} className="flex items-baseline gap-2 text-[10.5px]">
                  <span className="w-11 shrink-0 text-[#5b6275] capitalize">{i.side}</span>
                  <span className="truncate font-mono">{i.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[#5b6275]">{i.sha256 ? `${i.sha256.slice(0, 8)}…` : '…'}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 pt-2">
              <div className="border-t border-[#161a26] pt-1 text-[9px] text-[#5b6275]">Reviewed by</div>
              <div className="border-t border-[#161a26] pt-1 text-[9px] text-[#5b6275]">Approved by</div>
            </div>
          </div>
          {!fingerprinted && (
            <p className="mt-2 text-[12px] text-ink-500 dark:text-ink-400">Fingerprints are still being computed; they will be in the file once done.</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--border-card)] pt-5">
        <Button variant="primary" icon={<DownloadIcon />} onClick={download} disabled={disabled}>
          Download report
        </Button>
        <Button icon={<ReportIcon />} onClick={preview} disabled={disabled}>
          Open printable view
        </Button>
        <CopyButton text={disabled ? '' : reportMarkdown(report)} label="Copy summary as Markdown" />
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- engine */

function EngineBadge({ state }: { state: EngineState }) {
  const map = {
    idle: { dot: 'bg-ink-400', label: 'Engine starts on first file' },
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
