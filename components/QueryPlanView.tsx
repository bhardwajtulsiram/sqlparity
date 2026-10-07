'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { parsePlan, stepName, type PlanStep } from '@/lib/plan';
import type { ReviewFinding } from '@/lib/review';
import { AlertIcon, ChevronIcon, InfoIcon } from '@/components/icons';
import { Toggle } from '@/components/ui';

const n = (value: number) => Math.round(value).toLocaleString('en-US');

function ms(value: number): string {
  if (value < 0.1) return '<0.1 ms';
  if (value < 10) return `${value.toFixed(1)} ms`;
  return `${n(value)} ms`;
}

/**
 * A query plan, drawn as the steps the engine actually ran.
 *
 * Read from the bottom up: each step feeds the one above it, from the scans at the
 * leaves to the result at the top. Every step shows the rows it produced and its own
 * share of the time, and the slowest one is marked — that is where to look first.
 */
export function QueryPlanView({ json, findings }: { json: string; findings: ReviewFinding[] }) {
  const [showAll, setShowAll] = useState(false);
  const plan = useMemo(() => parsePlan(json, !showAll), [json, showAll]);
  const hottest = useMemo(() => {
    let best: PlanStep | null = null;
    const walk = (s: PlanStep) => {
      if (!best || s.ms > best.ms) best = s;
      s.children.forEach(walk);
    };
    walk(plan.root);
    return (best as PlanStep | null)?.id ?? -1;
  }, [plan]);
  const flagged = new Set(plan.insights.filter((i) => i.tone === 'warn').map((i) => i.stepId));

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Total time" value={ms(plan.totalMs)} />
        <Figure label="Rows returned" value={n(plan.rowsReturned)} />
        <Figure label="Rows read" value={n(plan.rowsScanned)} />
        <Figure label="Steps" value={n(count(plan.root))} />
      </dl>

      {(plan.insights.length > 0 || findings.length > 0) && (
        <ul className="space-y-2">
          {plan.insights.map((insight, i) => (
            <li
              key={`p${i}`}
              className={`flex gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed ${
                insight.tone === 'warn'
                  ? 'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-[var(--border-card)] bg-[var(--surface-header)]'
              }`}
            >
              {insight.tone === 'warn' ? (
                <AlertIcon className="mt-[3px] size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              ) : (
                <InfoIcon className="mt-[3px] size-4 shrink-0 text-accent-600 dark:text-accent-400" />
              )}
              <span>
                <b className="font-semibold">{insight.title}.</b> {insight.why}
              </span>
            </li>
          ))}
          {findings.map((f) => (
            <li key={f.rule} className="flex gap-3 rounded-lg border border-[var(--border-card)] bg-[var(--surface-header)] px-3.5 py-2.5 text-[13px] leading-relaxed">
              <InfoIcon className="mt-[3px] size-4 shrink-0 text-ink-400" />
              <span>
                <b className="font-semibold">From the Query Optimizer: {f.title}.</b> {f.fix}{' '}
                <Link href="/query-optimizer/" className="text-accent-700 hover:underline dark:text-accent-400">
                  Why
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[12.5px] text-ink-500 dark:text-ink-400">
            Read from the bottom up: each step feeds the one above it. Bars show each step&apos;s own share of the time.
          </p>
          <span className="ml-auto">
            <Toggle checked={showAll} onChange={setShowAll} label="Show every step" />
          </span>
        </div>
        <div className="code-scroll overflow-x-auto rounded-xl border p-3" style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)' }}>
          <Step step={plan.root} depth={0} hottest={hottest} flagged={flagged} />
        </div>
      </div>
    </div>
  );
}

function count(step: PlanStep): number {
  return 1 + step.children.reduce((sum, c) => sum + count(c), 0);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-card)] px-4 py-3">
      <dt className="text-[12px] font-medium text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="mt-0.5 font-mono text-[20px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Step({ step, depth, hottest, flagged }: { step: PlanStep; depth: number; hottest: number; flagged: Set<number> }) {
  const [open, setOpen] = useState(false);
  const hot = step.id === hottest && step.share >= 0.2;
  const warn = flagged.has(step.id);
  const pct = Math.round(step.share * 100);

  return (
    <div className={depth > 0 ? 'ml-5 border-l pl-3' : ''} style={depth > 0 ? { borderColor: 'var(--code-border)' } : undefined}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`my-1 grid w-full min-w-[34rem] grid-cols-[minmax(0,1fr)_6rem_10rem] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
          hot || warn ? '' : 'border-transparent hover:bg-white/[0.04]'
        }`}
        style={
          warn
            ? { borderColor: 'oklch(0.75 0.15 75 / 0.6)', background: 'oklch(0.75 0.15 75 / 0.08)' }
            : hot
              ? { borderColor: 'oklch(0.66 0.2 25 / 0.55)', background: 'oklch(0.66 0.2 25 / 0.08)' }
              : undefined
        }
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <ChevronIcon className={`size-3 shrink-0 text-[var(--syn-comment)] transition-transform ${open ? 'rotate-90' : ''}`} />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--syn-plain)' }}>
              {stepName(step)}
            </span>
            {hot && (
              <span className="rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={{ background: 'oklch(0.66 0.2 25 / 0.2)', color: 'oklch(0.82 0.12 25)' }}>
                slowest
              </span>
            )}
            {step.folded > 0 && (
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--syn-comment)' }}>
                +{step.folded} column step{step.folded === 1 ? '' : 's'}
              </span>
            )}
          </span>
          {step.summary && (
            <span className="mt-0.5 block truncate pl-5 font-mono text-[11.5px]" style={{ color: 'var(--syn-comment)' }} title={step.summary}>
              {step.summary}
            </span>
          )}
        </span>
        <span className="text-right font-mono text-[12px]" style={{ color: 'var(--syn-number)' }}>
          {n(step.rows)} <span style={{ color: 'var(--syn-comment)' }}>rows</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(pct, step.ms > 0 ? 2 : 0)}%`, background: hot ? 'oklch(0.66 0.2 25)' : 'var(--syn-function)' }}
            />
          </span>
          <span className="w-14 text-right font-mono text-[11.5px]" style={{ color: 'var(--syn-comment)' }}>
            {ms(step.ms)}
          </span>
        </span>
      </button>

      {open && (
        <dl className="mb-2 ml-5 grid gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 font-mono text-[11.5px] sm:grid-cols-[10rem_minmax(0,1fr)]" style={{ background: 'var(--code-header)' }}>
          <dt style={{ color: 'var(--syn-comment)' }}>operator</dt>
          <dd style={{ color: 'var(--syn-plain)' }}>{step.operator}</dd>
          {step.estimate !== undefined && (
            <>
              <dt style={{ color: 'var(--syn-comment)' }}>estimated rows</dt>
              <dd style={{ color: 'var(--syn-plain)' }}>{n(step.estimate)}</dd>
            </>
          )}
          {step.rowsScanned > 0 && (
            <>
              <dt style={{ color: 'var(--syn-comment)' }}>rows read</dt>
              <dd style={{ color: 'var(--syn-plain)' }}>{n(step.rowsScanned)}</dd>
            </>
          )}
          {step.details
            .filter(([k]) => k !== 'Estimated Cardinality')
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt style={{ color: 'var(--syn-comment)' }}>{k.toLowerCase()}</dt>
                <dd className="break-words whitespace-pre-wrap" style={{ color: 'var(--syn-identifier)' }}>
                  {v}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {step.children.map((child) => (
        <Step key={child.id} step={child} depth={depth + 1} hottest={hottest} flagged={flagged} />
      ))}
    </div>
  );
}
