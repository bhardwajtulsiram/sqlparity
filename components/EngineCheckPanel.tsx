'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDialect } from '@/lib/dialects';
import {
  compareResults,
  ENGINE_LABEL,
  engineFor,
  inferSchema,
  isOrdered,
  renderSetup,
  type Comparison,
  type EngineId,
  type EngineRows,
} from '@/lib/engine-check';
import { SqlEditor } from '@/components/SqlEditor';
import {
  AlertIcon,
  CheckCircleIcon,
  EngineIcon,
  ErrorIcon,
  NotEqualIcon,
  ParityIcon,
  PlayIcon,
  ResetIcon,
} from '@/components/icons';
import { Button, Note, Panel } from '@/components/ui';

type RunState =
  | { status: 'running' }
  | { status: 'ok'; rows: EngineRows; version: string; ms: number }
  | { status: 'error'; stage: 'setup' | 'query' | 'start'; message: string; version?: string };

interface Runs {
  target?: RunState;
  source?: RunState;
  comparison?: Comparison;
  /** What the run was for, to notice when the query or the setup changes after it. */
  inputs: string;
}

const RUNNABLE = 'PostgreSQL, SQLite and DuckDB';

/** A cell as the engine returned it, readable: no "[object Object]", no lost NULLs. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Run the converted query on a real database engine, in the tab.
 *
 * The converter's change list says what was rewritten; this says whether the result
 * runs, and — when the source dialect also has an in-browser engine — whether it
 * returns the same rows as the original on the same data. The sample tables are
 * guessed from the query and shown as editable SQL, so a wrong guess can be fixed
 * rather than mistaken for a broken conversion.
 */
export function EngineCheckPanel({
  fromId,
  toId,
  sourceSql,
  targetSql,
}: {
  fromId: string;
  toId: string;
  sourceSql: string;
  targetSql: string;
}) {
  const targetEngine = engineFor(toId);
  const sourceEngine = engineFor(fromId);
  const compareSource = !!targetEngine && !!sourceEngine && fromId !== toId;

  const generated = useMemo(
    () => (targetEngine ? renderSetup(inferSchema(targetSql, getDialect(toId))) : ''),
    [targetSql, toId, targetEngine],
  );
  const [setup, setSetup] = useState(generated);
  const [edited, setEdited] = useState(false);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [downloaded, setDownloaded] = useState<Set<EngineId>>(new Set());

  // Follow the query while the setup is the generated one; stop once it is edited.
  useEffect(() => {
    if (!edited) setSetup(generated);
  }, [generated, edited]);

  const inputsKey = JSON.stringify([fromId, toId, sourceSql, targetSql, setup]);
  const busy = runs?.target?.status === 'running' || runs?.source?.status === 'running';

  const run = useCallback(async () => {
    if (!targetEngine) return;
    const key = inputsKey;
    setRuns({ inputs: key, target: { status: 'running' }, source: compareSource ? { status: 'running' } : undefined });
    const { getEngine, CheckError } = await import('@/lib/engines');

    const runOn = async (id: EngineId, sql: string): Promise<RunState> => {
      let version: string | undefined;
      try {
        const engine = await getEngine(id);
        version = engine.version;
        setDownloaded((d) => new Set(d).add(id));
        const started = performance.now();
        const rows = await engine.run(setup, sql);
        return { status: 'ok', rows, version, ms: performance.now() - started };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const stage = error instanceof CheckError ? error.stage : 'start';
        return { status: 'error', stage, message: msg, version };
      }
    };

    const target = await runOn(targetEngine, targetSql);
    setRuns((r) => (r?.inputs === key ? { ...r, target } : r));
    if (compareSource && sourceEngine) {
      const source = await runOn(sourceEngine, sourceSql);
      const comparison =
        source.status === 'ok' && target.status === 'ok'
          ? compareResults(source.rows, target.rows, isOrdered(sourceSql, getDialect(fromId)))
          : undefined;
      setRuns((r) => (r?.inputs === key ? { ...r, source, comparison } : r));
    }
  }, [targetEngine, sourceEngine, compareSource, inputsKey, setup, targetSql, sourceSql, fromId]);

  if (fromId === toId && !targetEngine) return null;

  if (!targetEngine) {
    return (
      <Panel step={3} title="Check it on a real engine">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--surface-header)] text-ink-500 dark:text-ink-400">
            <EngineIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
            <p className="font-medium">{getDialect(toId).label} cannot run inside a browser, so this conversion cannot be executed here.</p>
            <p className="mt-1 text-ink-500 dark:text-ink-400">
              Only {RUNNABLE} have engines that run in a tab. Convert to one of them to run the query for real on sample
              tables — and when the source is one too, to check that both return the same rows.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  const stale = runs && runs.inputs !== inputsKey && !busy;
  const targetLabel = ENGINE_LABEL[targetEngine];

  return (
    <Panel
      step={3}
      tone="primary"
      title="Check it on a real engine"
      description={
        compareSource
          ? `Runs the ${getDialect(fromId).label} original and the ${getDialect(toId).label} conversion on the same sample tables, then compares the answers.`
          : `Runs the converted query on a real ${targetLabel} engine inside this tab.`
      }
      actions={<RunButton engine={targetEngine} second={compareSource ? sourceEngine : null} downloaded={downloaded} busy={!!busy} onRun={() => void run()} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold">Sample tables</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                edited ? 'bg-accent-500/12 text-accent-700 dark:text-accent-300' : 'bg-ink-500/10 text-ink-500 dark:text-ink-400'
              }`}
            >
              {edited ? 'Edited' : 'Guessed from the query'}
            </span>
            {edited && (
              <span className="ml-auto">
                <Button
                  variant="ghost"
                  icon={<ResetIcon />}
                  onClick={() => {
                    setEdited(false);
                    setSetup(generated);
                  }}
                >
                  Guess again
                </Button>
              </span>
            )}
          </div>
          <SqlEditor
            value={setup}
            onChange={(next) => {
              setSetup(next);
              setEdited(next !== generated);
            }}
            dialectId={toId}
            minHeight="300px"
            placeholderText="CREATE TABLE … and INSERT … statements the query can run against"
          />
          <p className="mt-2 text-[12px] leading-relaxed text-ink-500 dark:text-ink-400">
            Created in memory for each run and thrown away afterwards. Paste your real <code className="font-mono">CREATE TABLE</code> and a few rows for an exact check.
          </p>
        </div>

        <div className={`space-y-3 transition-opacity ${stale ? 'opacity-55' : ''}`}>
          {!runs ? (
            <WhatHappens engine={targetLabel} compare={compareSource ? ENGINE_LABEL[sourceEngine!] : null} />
          ) : (
            <>
              {stale && <Note tone="warn">The query or the sample tables changed. Run the check again.</Note>}
              <EngineCard role={getDialect(toId).label} subtitle="The converted query" state={runs.target} edited={edited} />
              {compareSource && (
                <EngineCard role={getDialect(fromId).label} subtitle="The original query" state={runs.source} edited={edited} />
              )}
              {compareSource && <ComparisonCard runs={runs} />}
              {runs.target?.status === 'ok' && <RowsPreview rows={runs.target.rows} />}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

function RunButton({
  engine,
  second,
  downloaded,
  busy,
  onRun,
}: {
  engine: EngineId;
  second: EngineId | null;
  downloaded: Set<EngineId>;
  busy: boolean;
  onRun: () => void;
}) {
  const [sizes, setSizes] = useState<Record<EngineId, number> | null>(null);
  useEffect(() => {
    void import('@/lib/engines').then((m) => setSizes(m.DOWNLOAD_MB));
  }, []);
  const pending = [engine, second].filter((e): e is EngineId => !!e && !downloaded.has(e));
  const mb = sizes ? pending.reduce((sum, id) => sum + sizes[id], 0) : 0;
  return (
    <Button variant="primary" icon={<PlayIcon />} onClick={onRun} disabled={busy}>
      {busy ? 'Running…' : `Run on ${ENGINE_LABEL[engine]}${second ? ` and ${ENGINE_LABEL[second]}` : ''}`}
      {!busy && mb >= 1 && <span className="font-normal opacity-80">· {Math.round(mb)} MB, once</span>}
    </Button>
  );
}

function WhatHappens({ engine, compare }: { engine: string; compare: string | null }) {
  const steps = [
    `Starts a real ${engine}${compare ? ` and ${compare}` : ''} in this tab, downloaded from this site the first time only.`,
    'Creates the sample tables on the left, in memory.',
    compare ? 'Runs both queries and compares the rows they return.' : 'Runs the converted query and shows what it returns, or the exact error.',
    'Throws the tables away. Nothing is sent anywhere.',
  ];
  return (
    <div className="h-full rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-sunken)] p-5">
      <div className="flex items-center gap-2.5 text-[13px] font-semibold">
        <EngineIcon className="size-4 text-accent-600 dark:text-accent-400" />
        What the check does
      </div>
      <ol className="mt-3 space-y-2.5">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-card)] font-mono text-[10.5px] font-semibold ring-1 ring-[var(--border-strong)]">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function hintFor(state: Extract<RunState, { status: 'error' }>, edited: boolean): string | null {
  if (state.stage === 'start') return 'The engine could not start in this browser.';
  if (state.stage === 'setup') return 'The sample tables could not be created. Correct the statements on the left.';
  if (/function .* does not exist|no such function|scalar function .* does not exist|unknown function/i.test(state.message)) {
    return 'The engine has no such function — this part of the conversion needs a change.';
  }
  if (!edited && /operator does not exist|cannot be applied|could not convert|type mismatch|invalid input syntax/i.test(state.message)) {
    return 'This may come from a guessed column type. Correct the type on the left, then run again.';
  }
  if (!edited && /column .* does not exist|no such column|not found in from clause|referenced column/i.test(state.message)) {
    return 'A column the query needs is missing from the guessed tables. Add it on the left.';
  }
  return null;
}

function EngineCard({
  role,
  subtitle,
  state,
  edited,
}: {
  role: string;
  subtitle: string;
  state: RunState | undefined;
  edited: boolean;
}) {
  if (!state) return null;
  const ok = state.status === 'ok';
  const failed = state.status === 'error';
  return (
    <div
      className={`rounded-xl border p-4 ${
        ok
          ? 'border-[color-mix(in_oklab,var(--signal)_40%,transparent)] bg-[var(--signal-soft)]'
          : failed
            ? 'border-red-300/70 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30'
            : 'border-[var(--border-card)] bg-[var(--surface-header)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
            ok ? 'bg-[var(--signal)] text-white' : failed ? 'bg-red-500 text-white' : 'bg-[var(--surface-card)] text-accent-600 ring-1 ring-[var(--border-card)]'
          }`}
        >
          {ok ? <CheckCircleIcon className="size-4" /> : failed ? <ErrorIcon className="size-4" /> : <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">
            {ok ? `Runs on ${state.version}` : failed ? (state.stage === 'setup' ? 'Sample tables failed' : `Fails on ${state.version ?? role}`) : `Running on ${role}…`}
          </p>
          <p className="text-[12px] text-ink-500 dark:text-ink-400">{subtitle}</p>
        </div>
        {ok && (
          <span className="ml-auto shrink-0 font-mono text-[11.5px] text-ink-500 dark:text-ink-400">
            {state.rows.rows.length.toLocaleString('en-US')} row{state.rows.rows.length === 1 ? '' : 's'} · {Math.max(1, Math.round(state.ms))} ms
          </span>
        )}
      </div>
      {failed && (
        <div className="mt-3 space-y-2">
          <pre className="code-scroll overflow-x-auto rounded-lg px-3 py-2 font-mono text-[12px] whitespace-pre-wrap" style={{ background: 'var(--code-surface)', color: 'oklch(0.82 0.11 25)' }}>
            {state.message}
          </pre>
          {hintFor(state, edited) && (
            <p className="flex gap-2 text-[12.5px] leading-relaxed text-red-900 dark:text-red-200">
              <AlertIcon className="mt-[2px] size-3.5 shrink-0" />
              {hintFor(state, edited)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ComparisonCard({ runs }: { runs: Runs }) {
  const c = runs.comparison;
  if (!c) {
    if (runs.source?.status === 'running' || runs.target?.status === 'running') return null;
    return (
      <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-header)] p-4 text-[13px] text-ink-600 dark:text-ink-300">
        The answers could not be compared, because one of the queries did not run.
      </div>
    );
  }
  const rows = runs.target?.status === 'ok' ? runs.target.rows.rows.length : 0;
  return (
    <div
      className={`rounded-xl border-2 p-4 ${
        c.same
          ? 'border-[color-mix(in_oklab,var(--signal)_55%,transparent)] bg-[var(--surface-card)]'
          : 'border-red-400/70 bg-[var(--surface-card)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex size-9 items-center justify-center rounded-xl text-white ${c.same ? 'bg-[var(--signal)]' : 'bg-red-500'}`}>
          {c.same ? <ParityIcon className="size-5" /> : <NotEqualIcon className="size-5" />}
        </span>
        <div>
          <p className="text-[14.5px] font-semibold">
            {c.same
              ? rows === 0
                ? 'Same answer — both return no rows'
                : `Same answer — ${rows.toLocaleString('en-US')} identical row${rows === 1 ? '' : 's'}`
              : c.columnCountDiffers
                ? 'Different answers — the number of columns differs'
                : 'Different answers on the same data'}
          </p>
          <p className="text-[12px] text-ink-500 dark:text-ink-400">
            {c.same && rows === 0
              ? 'Add rows on the left that the query should return, for a stronger check.'
              : 'Compared after normalising number, boolean and date formatting.'}
          </p>
        </div>
      </div>
      {!c.same && !c.columnCountDiffers && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <DiffRows title="Only from the original" rows={c.onlyLeft} />
          <DiffRows title="Only from the conversion" rows={c.onlyRight} />
        </div>
      )}
    </div>
  );
}

function DiffRows({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11.5px] font-medium text-ink-500 dark:text-ink-400">{title}</p>
      <div className="code-scroll max-h-36 overflow-auto rounded-lg px-3 py-2 font-mono text-[12px]" style={{ background: 'var(--code-surface)', color: 'var(--syn-plain)' }}>
        {rows.length === 0 ? <span style={{ color: 'var(--syn-comment)' }}>none</span> : rows.slice(0, 20).map((r, i) => <div key={i} className="whitespace-pre">{r.join(' | ')}</div>)}
      </div>
    </div>
  );
}

function RowsPreview({ rows }: { rows: EngineRows }) {
  if (rows.columns.length === 0) return null;
  const shown = rows.rows.slice(0, 8);
  return (
    <div className="code-scroll overflow-x-auto rounded-xl border" style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)' }}>
      <table className="w-full border-collapse font-mono text-[12px]">
        <thead>
          <tr style={{ background: 'var(--code-header)', color: 'var(--syn-comment)' }}>
            {rows.columns.map((c, i) => (
              <th key={i} className="px-3 py-2 text-left font-normal whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={rows.columns.length} className="px-3 py-3" style={{ color: 'var(--syn-comment)' }}>
                (no rows)
              </td>
            </tr>
          ) : (
            shown.map((r, i) => (
              <tr key={i} className="border-t" style={{ borderColor: 'var(--code-border)' }}>
                {r.map((v, j) => (
                  <td key={j} className="px-3 py-1.5 whitespace-nowrap" style={{ color: v == null ? 'var(--syn-comment)' : 'var(--syn-plain)' }}>
                    {cellText(v)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
