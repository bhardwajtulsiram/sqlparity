'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { diffColumns, looksLikeDdl, parseDdl, type DdlChange } from '@/lib/ddl';
import { sendFieldsHandoff } from '@/lib/handoff';
import { usePersistentState } from '@/lib/settings';
import { Button, DialectSelect, Note, Panel, PasteArea, Toggle } from '@/components/ui';

const BEFORE_EXAMPLE = `CREATE EXTERNAL TABLE prod_db.customer_snapshot (
  customer_id string,
  customer_segment varchar(50),
  order_count bigint,
  lifetime_value double
);`;

const AFTER_EXAMPLE = `CREATE EXTERNAL TABLE prod_db.customer_snapshot (
  customer_id string,
  customer_segment varchar(50),
  order_count int,
  lifetime_value double,
  last_order_at timestamp,
  churn_risk double
);`;

const STATUS_STYLE: Record<DdlChange['kind'], string> = {
  added: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  removed: 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-300',
  retyped: 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  unchanged: 'text-ink-500 dark:text-ink-400',
};

const STATUS_LABEL: Record<DdlChange['kind'], string> = {
  added: 'Added',
  removed: 'Removed',
  retyped: 'Type changed',
  unchanged: 'Unchanged',
};

interface Side {
  state: 'idle' | 'pending' | 'ready' | 'error';
  changes: import('@/lib/ddl').DdlColumn[];
  table?: string;
}

export function SchemaDiffTool() {
  const router = useRouter();
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);
  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);

  const [beforeText, setBeforeText] = useState(BEFORE_EXAMPLE);
  const [afterText, setAfterText] = useState(AFTER_EXAMPLE);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const [beforeParsed, setBeforeParsed] = useState<Side>({ state: 'idle', changes: [] });
  const [afterParsed, setAfterParsed] = useState<Side>({ state: 'idle', changes: [] });

  useEffect(() => {
    if (!looksLikeDdl(beforeText)) {
      setBeforeParsed({ state: 'idle', changes: [] });
      return;
    }
    let cancelled = false;
    setBeforeParsed((s) => ({ ...s, state: 'pending' }));
    const timer = setTimeout(() => {
      parseDdl(beforeText, dialectId)
        .then((r) => {
          if (!cancelled) setBeforeParsed({ state: 'ready', changes: r.columns, table: r.table });
        })
        .catch(() => {
          if (!cancelled) setBeforeParsed({ state: 'error', changes: [] });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [beforeText, dialectId]);

  useEffect(() => {
    if (!looksLikeDdl(afterText)) {
      setAfterParsed({ state: 'idle', changes: [] });
      return;
    }
    let cancelled = false;
    setAfterParsed((s) => ({ ...s, state: 'pending' }));
    const timer = setTimeout(() => {
      parseDdl(afterText, dialectId)
        .then((r) => {
          if (!cancelled) setAfterParsed({ state: 'ready', changes: r.columns, table: r.table });
        })
        .catch(() => {
          if (!cancelled) setAfterParsed({ state: 'error', changes: [] });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [afterText, dialectId]);

  const diff = useMemo(() => {
    if (beforeParsed.state !== 'ready' || afterParsed.state !== 'ready') return null;
    return diffColumns(beforeParsed.changes, afterParsed.changes);
  }, [beforeParsed, afterParsed]);

  const visible = useMemo(() => {
    if (!diff) return [];
    return showUnchanged ? diff : diff.filter((c) => c.kind !== 'unchanged');
  }, [diff, showUnchanged]);

  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, retyped: 0, unchanged: 0 };
    for (const change of diff ?? []) c[change.kind]++;
    return c;
  }, [diff]);

  // Only columns that exist in the current ("after") schema are worth checking — a
  // removed column has nothing on the output side to compare against.
  const checkable = useMemo(
    () => (diff ?? []).filter((c) => c.kind === 'added' || c.kind === 'retyped'),
    [diff],
  );

  function sendToGenerator() {
    const grid = checkable.map((c) => `${c.name}\t${c.after}`).join('\n');
    sendFieldsHandoff(grid);
    router.push('/bulk-query-generator/');
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Schema diff</h1>
          <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
            Paste the old and new <code className="font-mono">CREATE TABLE</code>, see what
            changed, and check only that.
          </p>
        </div>
        <div className="w-56">
          <DialectSelect value={dialectId} onChange={setDialectId} label="Read DDL as" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title="Before"
          description="The schema as it was."
          actions={
            <Button variant="ghost" onClick={() => setBeforeText(BEFORE_EXAMPLE)}>
              Example
            </Button>
          }
        >
          <PasteArea value={beforeText} onChange={setBeforeText} rows={10} minHeight="26vh" />
          {beforeParsed.state === 'error' && (
            <div className="mt-3">
              <Note tone="warn">Could not read that as a CREATE TABLE.</Note>
            </div>
          )}
        </Panel>

        <Panel
          step={2}
          title="After"
          description="The schema now."
          actions={
            <Button variant="ghost" onClick={() => setAfterText(AFTER_EXAMPLE)}>
              Example
            </Button>
          }
        >
          <PasteArea value={afterText} onChange={setAfterText} rows={10} minHeight="26vh" />
          {afterParsed.state === 'error' && (
            <div className="mt-3">
              <Note tone="warn">Could not read that as a CREATE TABLE.</Note>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        step={3}
        tone="primary"
        title="What changed"
        description={
          diff
            ? `${counts.added} added · ${counts.removed} removed · ${counts.retyped} retyped · ${counts.unchanged} unchanged`
            : 'Paste both schemas above.'
        }
        actions={
          <>
            <Toggle checked={showUnchanged} onChange={setShowUnchanged} label="Show unchanged" />
            <Button
              variant="primary"
              onClick={sendToGenerator}
              disabled={checkable.length === 0}
              title="Send the added and retyped columns to the bulk generator"
            >
              Generate checks for changed columns
            </Button>
          </>
        }
      >
        {!diff ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Paste a <code className="font-mono">CREATE TABLE</code> on both sides to see the
            difference.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            No differences — the two schemas match.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-ink-500 dark:text-ink-400">
                  <th className="py-2 pr-4 font-medium">Column</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Before</th>
                  <th className="py-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((change) => (
                  <tr key={change.name} className="border-b border-[var(--border-card)] last:border-0">
                    <td className="py-2 pr-4 font-mono font-medium">{change.name}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[change.kind]}`}>
                        {STATUS_LABEL[change.kind]}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-ink-500 dark:text-ink-400">
                      {change.before ?? '—'}
                    </td>
                    <td className="py-2 font-mono text-ink-500 dark:text-ink-400">
                      {change.after ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {diff && checkable.length === 0 && diff.some((c) => c.kind !== 'unchanged') && (
          <div className="mt-4">
            <Note>
              Only removed columns changed — there is nothing on the current schema to check them
              against, so there is nothing to send to the generator.
            </Note>
          </div>
        )}
      </Panel>
    </div>
  );
}
