'use client';

import { useMemo, useState } from 'react';
import { convertSql } from '@/lib/convert';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { usePersistentState } from '@/lib/settings';
import { SqlEditor } from '@/components/SqlEditor';
import { Button, CopyButton, DialectSelect, Note, Panel } from '@/components/ui';

const EXAMPLE = `SELECT TOP 10
  [customer id],
  LEN([customer name]) AS name_length,
  ISNULL([segment], 'unknown') AS segment,
  CAST([total] AS VARCHAR) AS total_text
FROM [sales].[orders]
WHERE [created_at] > GETDATE()
  AND [note] = 'O''Brien'`;

/**
 * Conversion with the receipts shown.
 *
 * Two panels would be enough to look finished, and would be the wrong shape: a
 * converted query you cannot check is a query you have to run to find out about. So
 * the result comes with both lists — what was rewritten, and what was recognised and
 * deliberately left alone, each with the reason. The second list is the useful one.
 */
export function SqlConverterTool() {
  const [input, setInput] = useState(EXAMPLE);
  const [fromId, setFromId] = usePersistentState('convert-from', 'transactsql');
  const [toId, setToId] = usePersistentState('convert-to', DEFAULT_DIALECT_ID);

  const from = useMemo(() => getDialect(fromId), [fromId]);
  const to = useMemo(() => getDialect(toId), [toId]);
  const result = useMemo(() => convertSql(input, from, to), [input, from, to]);

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-4 rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SQL converter</h1>
          <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
            Rewrite quoting, escaping, row limits and function names between 16 dialects.
          </p>
        </div>
        <div className="w-52">
          <DialectSelect value={fromId} onChange={setFromId} label="From" />
        </div>
        <Button onClick={swap} title="Swap the two dialects">
          Swap
        </Button>
        <div className="w-52">
          <DialectSelect value={toId} onChange={setToId} label="To" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title={`${from.label} query`}
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
              Nothing needed rewriting — {from.label} and {to.label} agree on everything this query
              uses.
            </Note>
          ) : (
            <ul className="space-y-2">
              {result.changes.map((change) => (
                <li
                  key={change.kind + change.from}
                  className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg bg-[var(--surface-sunken)] px-3.5 py-2.5 text-[13px]"
                >
                  <code className="font-mono text-ink-500 line-through dark:text-ink-400">
                    {change.from}
                  </code>
                  <span aria-hidden="true" className="text-ink-400">
                    →
                  </span>
                  <code className="font-mono font-medium">{change.to}</code>
                  <span className="ml-auto text-xs text-ink-500 dark:text-ink-400">
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
