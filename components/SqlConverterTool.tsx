'use client';

import { useEffect, useMemo, useState } from 'react';
import { convertSql } from '@/lib/convert';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { usePersistentState } from '@/lib/settings';
import { decodeShareState } from '@/lib/share';
import { ShareButton } from '@/components/ShareButton';
import { SqlEditor } from '@/components/SqlEditor';
import { ToolHeader } from '@/components/ToolHeader';
import { ArrowRightIcon, EraseIcon, SparkIcon, SwapIcon } from '@/components/icons';
import { Button, CopyButton, DialectSelect, Note, Panel } from '@/components/ui';

const EXAMPLE = `SELECT TOP 10
  [customer id],
  LEN([customer name]) AS name_length,
  ISNULL([segment], 'unknown') AS segment,
  CAST([total] AS VARCHAR) AS total_text
FROM [sales].[orders]
WHERE [created_at] > GETDATE()
  AND [note] = 'O''Brien'`;

export interface SqlConverterToolProps {
  initialFromId?: string;
  initialToId?: string;
}

/**
 * Conversion with the receipts shown.
 *
 * Two panels would be enough to look finished, and would be the wrong shape: a
 * converted query you cannot check is a query you have to run to find out about. So
 * the result comes with both lists — what was rewritten, and what was recognised and
 * deliberately left alone, each with the reason. The second list is the useful one.
 */
export function SqlConverterTool({ initialFromId, initialToId }: SqlConverterToolProps = {}) {
  const [input, setInput] = useState(EXAMPLE);
  const [persistentFrom, setPersistentFrom] = usePersistentState('convert-from', 'transactsql');
  const [persistentTo, setPersistentTo] = usePersistentState('convert-to', DEFAULT_DIALECT_ID);

  const [fromId, setFromId] = useState<string>(initialFromId || 'transactsql');
  const [toId, setToId] = useState<string>(initialToId || DEFAULT_DIALECT_ID);

  useEffect(() => {
    if (!initialFromId) {
      setFromId(persistentFrom);
    }
  }, [initialFromId, persistentFrom]);

  useEffect(() => {
    if (!initialToId) {
      setToId(persistentTo);
    }
  }, [initialToId, persistentTo]);

  // Restore shared state from URL hash (#share=...) if present
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const decoded = decodeShareState<{ input?: string; fromId?: string; toId?: string }>(
        window.location.hash
      );
      if (decoded) {
        if (decoded.input !== undefined) setInput(decoded.input);
        if (decoded.fromId) setFromId(decoded.fromId);
        if (decoded.toId) setToId(decoded.toId);
      }
    }
  }, []);

  const from = useMemo(() => getDialect(fromId), [fromId]);
  const to = useMemo(() => getDialect(toId), [toId]);
  const result = useMemo(() => convertSql(input, from, to), [input, from, to]);

  const handleFromChange = (newFrom: string) => {
    setFromId(newFrom);
    if (!initialFromId) setPersistentFrom(newFrom);
  };

  const handleToChange = (newTo: string) => {
    setToId(newTo);
    if (!initialToId) setPersistentTo(newTo);
  };

  const swap = () => {
    const prevFrom = fromId;
    const prevTo = toId;
    setFromId(prevTo);
    setToId(prevFrom);
    if (!initialFromId) setPersistentFrom(prevTo);
    if (!initialToId) setPersistentTo(prevFrom);
  };

  return (
    <div className="space-y-5">
      <ToolHeader
        href="/sql-converter/"
        description="Rewrite quoting, escaping, row limits and function names between 16 dialects, with a list of what it refused to guess at."
        status={
          <ShareButton
            getState={() => ({ input, fromId, toId })}
            label="Share Conversion"
          />
        }
      >
        <div className="w-52">
          <DialectSelect value={fromId} onChange={handleFromChange} label="From" />
        </div>
        <Button onClick={swap} title="Swap the two dialects" icon={<SwapIcon className="rotate-90" />}>
          Swap
        </Button>
        <div className="w-52">
          <DialectSelect value={toId} onChange={handleToChange} label="To" />
        </div>
      </ToolHeader>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title={`${from.label} query`}
          actions={
            <>
              <Button variant="ghost" icon={<SparkIcon />} onClick={() => setInput(EXAMPLE)}>
                Example
              </Button>
              <Button variant="ghost" icon={<EraseIcon />} onClick={() => setInput('')} disabled={!input}>
                Clear
              </Button>
            </>
          }
        >
          <SqlEditor
            value={input}
            onChange={setInput}
            dialectId={fromId}
            placeholderText="Paste the query you want to move"
            complete
            minHeight="40vh"
          />
        </Panel>

        <Panel
          step={2}
          tone="primary"
          title={`${to.label} query`}
          actions={<CopyButton text={result.sql} variant="primary" />}
        >
          <SqlEditor value={result.sql} readOnly dialectId={toId} minHeight="40vh" />
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="What it changed">
          {from.id === to.id ? (
            <Note>Both dialects are the same, so the query is unchanged.</Note>
          ) : result.changes.length === 0 ? (
            <Note>
              {result.unconverted.length === 0
                ? `Nothing needed rewriting — ${from.label} and ${to.label} agree on everything this query uses.`
                : 'Nothing was rewritten automatically. The part that differs is listed below, because a mechanical rewrite of it would change the answer.'}
            </Note>
          ) : (
            <ul className="space-y-2">
              {result.changes.map((change) => (
                <li
                  key={change.kind + change.from}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border px-3.5 py-2.5 text-[13px]"
                  style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)' }}
                >
                  <code
                    className="font-mono line-through decoration-1 opacity-80"
                    style={{ color: 'var(--syn-operator)' }}
                  >
                    {change.from}
                  </code>
                  <ArrowRightIcon className="size-3.5 shrink-0 text-[var(--syn-comment)]" />
                  <code className="font-mono font-medium" style={{ color: 'var(--syn-string)' }}>
                    {change.to}
                  </code>
                  <span
                    className="ml-auto rounded-full px-2 py-0.5 font-mono text-[11px]"
                    style={{ background: 'var(--code-header)', color: 'var(--syn-comment)' }}
                  >
                    {change.count} place{change.count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="What you still need to do"
          description={
            result.unconverted.length === 0
              ? undefined
              : `${result.unconverted.length} thing${
                  result.unconverted.length === 1 ? '' : 's'
                } this tool will not guess at`
          }
        >
          {result.unconverted.length === 0 ? (
            <Note tone="success">
              Nothing in this query is the kind of thing that translates wrongly. Still run it once
              before you trust it.
            </Note>
          ) : (
            <ul className="space-y-3">
              {result.unconverted.map((item) => (
                <li
                  key={item.feature}
                  className="rounded-lg border border-amber-300/60 bg-amber-50 p-3.5 dark:border-amber-800/60 dark:bg-amber-950/30"
                >
                  <h3 className="font-mono text-[13px] font-semibold text-amber-900 dark:text-amber-200">
                    {item.feature}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                    {item.why}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-5 border-t border-[var(--border-card)] pt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            Anything left in this list was recognised and left as it was on purpose. A function
            renamed to one that takes its arguments in a different order produces SQL that runs and
            returns the wrong rows, which is worse than SQL that fails.
          </p>
        </Panel>
      </div>
    </div>
  );
}
