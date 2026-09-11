'use client';

import { useMemo, useState } from 'react';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { lintSql } from '@/lib/lint';
import { reviewSql, RULE_COUNT, type ReviewFinding, type Severity } from '@/lib/review';
import { usePersistentState } from '@/lib/settings';
import { SqlEditor } from '@/components/SqlEditor';
import { Button, DialectSelect, Note, Panel, WarningList } from '@/components/ui';

const EXAMPLE = `SELECT *
FROM orders o, customers c
WHERE date(o.created_at) = '2026-01-01'
  AND c.name LIKE '%holdings'
ORDER BY o.total DESC`;

const SEVERITY_STYLE: Record<Severity, { dot: string; label: string }> = {
  high: { dot: 'bg-red-500', label: 'Costly' },
  medium: { dot: 'bg-amber-500', label: 'Worth fixing' },
  low: { dot: 'bg-ink-400', label: 'Worth knowing' },
};

function Finding({ finding }: { finding: ReviewFinding }) {
  const style = SEVERITY_STYLE[finding.severity];
  return (
    <li className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
      <div className="flex items-baseline gap-2.5">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <h3 className="text-[15px] font-semibold">{finding.title}</h3>
        <span className="ml-auto shrink-0 text-xs text-ink-500 dark:text-ink-400">
          {style.label}
        </span>
      </div>
      <p className="mt-2 pl-[1.125rem] text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
        {finding.why}
      </p>
      <p className="mt-2 pl-[1.125rem] text-[13px] leading-relaxed">
        <span className="font-medium">Do this instead: </span>
        <span className="text-ink-600 dark:text-ink-300">{finding.fix}</span>
      </p>
    </li>
  );
}

/**
 * A review, not a rewrite.
 *
 * The tempting version of this tool hands back a "faster" query. It would be a lie:
 * nothing in the browser knows your table sizes, partitions or indexes, so nothing
 * here can know which of two queries actually runs faster. What it can do is name the
 * shapes that are reliably expensive and explain the cost, which is the part you can
 * act on — and leave the rewrite to the person who knows the data.
 */
export function QueryOptimizerTool() {
  const [input, setInput] = useState(EXAMPLE);
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);

  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const findings = useMemo(() => reviewSql(input, dialect), [input, dialect]);
  const safety = useMemo(() => lintSql(input, dialect), [input, dialect]);

  const highCount = findings.filter((f) => f.severity === 'high').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Query optimizer</h1>
          <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
            {RULE_COUNT} checks for the patterns that make a query scan more than it needs to.
          </p>
        </div>
        <div className="w-56">
          <DialectSelect value={dialectId} onChange={setDialectId} label="Dialect" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title="Your query"
          actions={
            <>
              <Button variant="ghost" onClick={() => setInput(EXAMPLE)}>
                Example
              </Button>
              <Button variant="ghost" onClick={() => setInput('')} disabled={!input}>
                Clear
              </Button>
            </>
          }
        >
          <SqlEditor
            value={input}
            onChange={setInput}
            dialectId={dialectId}
            placeholderText="Paste a query here"
            minHeight="50vh"
            lint
          />
          <WarningList
            warnings={safety.map((f) => ({ level: 'warn' as const, message: f.message }))}
          />
        </Panel>

        <Panel
          step={2}
          tone="primary"
          title="What it found"
          description={
            input.trim() === ''
              ? undefined
              : findings.length === 0
                ? 'Nothing to flag'
                : `${findings.length} finding${findings.length === 1 ? '' : 's'}${
                    highCount > 0 ? `, ${highCount} costly` : ''
                  }`
          }
        >
          {input.trim() === '' ? (
            <Note>Paste a query on the left and the review appears here as you type.</Note>
          ) : findings.length === 0 ? (
            <Note tone="success">
              None of the {RULE_COUNT} patterns show up in this query. That is not a promise it is
              fast — only that it avoids the usual expensive shapes.
            </Note>
          ) : (
            <ul className="space-y-3">
              {findings.map((finding) => (
                <Finding key={finding.rule} finding={finding} />
              ))}
            </ul>
          )}

          <p className="mt-5 border-t border-[var(--border-card)] pt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            These are patterns in the text, not a cost estimate. Without your table sizes,
            partitions and indexes — none of which leave your machine — nothing here can tell you
            which of two queries is faster. Check the plan in your engine for that.
          </p>
        </Panel>
      </div>
    </div>
  );
}
