'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getDialect } from '@/lib/dialects';
import { buildInList, DEFAULT_BUILD, splitValues } from '@/lib/inlist';
import { Sql } from '@/components/Sql';
import { useExternalRequestCount } from '@/lib/network';

const STARTER = "O'Brien Holdings\nAcme, Inc.\n007\nMüller GmbH";

/**
 * Six dialects that disagree with each other visibly — one quotes identifiers with
 * brackets, one with backticks, and one escapes an apostrophe with a backslash
 * instead of doubling it. A duller six would make the switcher look decorative.
 *
 * Ordered most-used first, matching lib/dialects.ts. Leading with the dialect this
 * project happens to be built around would read as a niche tool rather than a general
 * one, so Athena takes its place in the order like everything else.
 */
const CHIPS = [
  { id: 'postgresql', name: 'Postgres' },
  { id: 'mysql', name: 'MySQL' },
  { id: 'transactsql', name: 'SQL Server' },
  { id: 'plsql', name: 'Oracle' },
  { id: 'bigquery', name: 'BigQuery' },
  { id: 'trino', name: 'Athena' },
];

/**
 * Type the starter values in once, so the tool is visibly working before it is
 * touched. Starts empty on the server and on first client render, so there is nothing
 * for hydration to disagree about; the effect then either fills it in one step (when
 * the reader has asked for less motion) or types it.
 */
function useTypedIn(full: string) {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setText(full);
      setTyping(false);
      return;
    }

    let i = 0;
    const timer = setInterval(() => {
      // Three characters a tick: done before anyone finishes the headline, slow
      // enough to register as the tool doing something rather than a static image.
      i = Math.min(i + 3, full.length);
      setText(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(timer);
        setTyping(false);
      }
    }, 26);
    return () => clearInterval(timer);
  }, [full]);

  return { text, setText, typing, stopTyping: () => setTyping(false) };
}

export function HeroDemo() {
  const [dialectId, setDialectId] = useState('postgresql');
  const { text, setText, typing, stopTyping } = useTypedIn(STARTER);
  const external = useExternalRequestCount();

  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const { output, count } = useMemo(() => {
    const values = splitValues(text, 'newline').filter((v) => v.trim() !== '');
    const built = buildInList(values, { ...DEFAULT_BUILD, dialect, wrapAt: 0 });
    return { output: built.output, count: built.valueCount };
  }, [text, dialect]);

  const escaping =
    dialect.quoteEscape === 'double'
      ? "apostrophes doubled ('')"
      : 'apostrophes backslash-escaped (\\\')';

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[0_24px_60px_-20px_oklch(0_0_0/0.55),0_0_0_1px_oklch(1_0_0/0.06)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-card)] bg-[var(--surface-header)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-[3px]">
          {CHIPS.map((chip) => {
            const active = chip.id === dialectId;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setDialectId(chip.id)}
                aria-pressed={active}
                className={
                  active
                    ? 'rounded-md bg-gradient-to-b from-accent-500 to-accent-600 px-2.5 py-1 font-mono text-xs font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_oklch(0.3_0.12_250/0.4)]'
                    : 'rounded-md px-2.5 py-1 font-mono text-xs text-ink-600 transition-colors hover:bg-[var(--surface-card)] hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100'
                }
              >
                {chip.name}
              </button>
            );
          })}
        </div>
        <Link
          href="/in-list-builder/"
          className="ml-auto text-[13px] font-medium text-accent-700 underline decoration-accent-500/40 underline-offset-4 hover:decoration-accent-500 dark:text-accent-400"
        >
          Open the builder
        </Link>
      </div>

      <div className="grid md:grid-cols-2">
        <div className="border-b border-[var(--border-card)] md:border-r md:border-b-0">
          <label htmlFor="hero-values" className="sr-only">
            Values to turn into an IN list
          </label>
          <textarea
            id="hero-values"
            value={text}
            onChange={(e) => {
              stopTyping();
              setText(e.target.value);
            }}
            onFocus={stopTyping}
            spellCheck={false}
            rows={6}
            aria-describedby="hero-count"
            placeholder="Paste a column of values"
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed outline-none focus:bg-[var(--surface-sunken)]"
          />
        </div>

        <div className="min-h-[10.5rem]" style={{ background: 'var(--code-surface)' }}>
          <output
            htmlFor="hero-values"
            className="block h-full overflow-x-auto p-4 text-[13px] leading-relaxed"
          >
            {output ? (
              <Sql code={output} dialectId={dialectId} className="break-words" />
            ) : (
              <span className="font-mono" style={{ color: 'var(--syn-comment)' }}>
                {typing ? '' : '-- paste a column of values on the left'}
              </span>
            )}
            {typing && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[1.05em] w-[0.5ch] translate-y-[0.15em] animate-pulse"
                style={{ background: 'var(--syn-plain)' }}
              />
            )}
          </output>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--border-card)] bg-[var(--surface-header)] px-4 py-2.5">
        <span id="hero-count" className="font-mono text-xs text-ink-500 dark:text-ink-400">
          {count} value{count === 1 ? '' : 's'} · {escaping}
        </span>

        {external !== null && (
          <span className="ml-auto flex items-center gap-2 font-mono text-xs">
            <span
              aria-hidden="true"
              className={`live-dot size-1.5 rounded-full ${external === 0 ? 'bg-emerald-500 text-emerald-500' : 'bg-red-500 text-red-500'}`}
            />
            <span className="text-ink-500 dark:text-ink-400">requests to another server</span>
            <span
              className={
                external === 0
                  ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                  : 'font-semibold text-red-700 dark:text-red-400'
              }
            >
              {external}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
