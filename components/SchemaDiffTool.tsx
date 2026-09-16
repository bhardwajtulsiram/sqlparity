'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_DIALECT_ID } from '@/lib/dialects';
import { diffColumns, looksLikeDdl, parseDdl, type DdlColumn } from '@/lib/ddl';
import {
  diffEsFields,
  diffEsSettings,
  looksLikeEsMapping,
  parseEsMapping,
  type EsAttributeChange,
  type EsField,
  type EsSettingChange,
} from '@/lib/es-mapping';
import { sendFieldsHandoff } from '@/lib/handoff';
import { usePersistentState } from '@/lib/settings';
import { Button, DialectSelect, Note, Panel, PasteArea, Toggle } from '@/components/ui';

const SQL_BEFORE = `CREATE EXTERNAL TABLE prod_db.customer_snapshot (
  customer_id string,
  customer_segment varchar(50),
  order_count bigint,
  lifetime_value double
);`;

const SQL_AFTER = `CREATE EXTERNAL TABLE prod_db.customer_snapshot (
  customer_id string,
  customer_segment varchar(50),
  order_count int,
  lifetime_value double,
  last_order_at timestamp,
  churn_risk double
);`;

/** The mapping you send to create an index. */
const ES_BEFORE = `{
  "mappings": {
    "properties": {
      "customer_id":    { "type": "keyword", "normalizer": "lowercase_normalizer" },
      "company_name":   { "type": "keyword", "normalizer": "lowercase_normalizer", "index": false },
      "employee_count": { "type": "long" },
      "created_at":     { "type": "date", "format": "date" }
    }
  },
  "settings": { "index": { "number_of_shards": "4", "number_of_replicas": "0" } }
}`;

/** What the cluster reports back: wrapped in the index name, keys reordered, extras added. */
const ES_AFTER = `{
  "orders_index": {
    "aliases": {},
    "mappings": {
      "properties": {
        "customer_id":    { "normalizer": "lowercase_normalizer", "type": "keyword" },
        "company_name":   { "index": false, "type": "keyword" },
        "employee_count": { "type": "keyword" },
        "created_at":     { "format": "date", "type": "date" }
      }
    },
    "settings": {
      "index": {
        "number_of_shards": "4",
        "number_of_replicas": "0",
        "uuid": "s0m3-g3n3r4t3d-1d",
        "creation_date": "1789530643110",
        "provided_name": "orders_index",
        "version": { "created": "8505000" }
      }
    }
  }
}`;

type ChangeKind = 'added' | 'removed' | 'retyped' | 'attributes' | 'unchanged';

interface Change {
  name: string;
  kind: ChangeKind;
  before?: string;
  after?: string;
  attributes?: EsAttributeChange[];
}

const STATUS_STYLE: Record<ChangeKind, string> = {
  added: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  removed: 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-300',
  retyped: 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  attributes: 'bg-accent-500/15 text-accent-700 dark:text-accent-400',
  unchanged: 'text-ink-500 dark:text-ink-400',
};

const STATUS_LABEL: Record<ChangeKind, string> = {
  added: 'Added',
  removed: 'Removed',
  retyped: 'Type changed',
  attributes: 'Settings changed',
  unchanged: 'Unchanged',
};

type Format = 'sql' | 'es' | 'unknown';

interface Side {
  state: 'idle' | 'pending' | 'ready' | 'error';
  format: Format;
  /** SQL columns or Elasticsearch fields, depending on `format`. */
  columns: DdlColumn[];
  fields: EsField[];
  settings: Record<string, string>;
  index?: string;
  error?: string;
}

const EMPTY: Side = { state: 'idle', format: 'unknown', columns: [], fields: [], settings: {} };

/** Which parser a pasted document belongs to. Decided per side, not by a mode switch. */
function detect(text: string): Format {
  if (looksLikeEsMapping(text)) return 'es';
  if (looksLikeDdl(text)) return 'sql';
  return 'unknown';
}

export function SchemaDiffTool() {
  const router = useRouter();
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);

  const [beforeText, setBeforeText] = useState(SQL_BEFORE);
  const [afterText, setAfterText] = useState(SQL_AFTER);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showGenerated, setShowGenerated] = useState(false);

  const [before, setBefore] = useState<Side>(EMPTY);
  const [after, setAfter] = useState<Side>(EMPTY);

  useSide(beforeText, dialectId, setBefore);
  useSide(afterText, dialectId, setAfter);

  const bothReady = before.state === 'ready' && after.state === 'ready';
  const format: Format = bothReady && before.format === after.format ? before.format : 'unknown';
  const mismatched = bothReady && before.format !== after.format;

  const diff = useMemo<Change[] | null>(() => {
    if (!bothReady || mismatched) return null;
    if (format === 'es') return diffEsFields(before.fields, after.fields);
    return diffColumns(before.columns, after.columns);
  }, [bothReady, mismatched, format, before, after]);

  const settingChanges = useMemo<EsSettingChange[]>(
    () => (format === 'es' ? diffEsSettings(before.settings, after.settings) : []),
    [format, before.settings, after.settings],
  );

  const realSettingChanges = settingChanges.filter((s) => !s.generated);
  const generatedSettings = settingChanges.filter((s) => s.generated);

  const visible = useMemo(
    () => (diff ?? []).filter((c) => showUnchanged || c.kind !== 'unchanged'),
    [diff, showUnchanged],
  );

  const counts = useMemo(() => {
    const c: Record<ChangeKind, number> = {
      added: 0,
      removed: 0,
      retyped: 0,
      attributes: 0,
      unchanged: 0,
    };
    for (const change of diff ?? []) c[change.kind]++;
    return c;
  }, [diff]);

  // Only fields present on the "after" side can be checked — a removed one has nothing
  // to compare against.
  const checkable = useMemo(
    () => (diff ?? []).filter((c) => c.kind === 'added' || c.kind === 'retyped'),
    [diff],
  );

  function sendToGenerator() {
    sendFieldsHandoff(checkable.map((c) => `${c.name}\t${c.after}`).join('\n'));
    router.push('/bulk-query-generator/');
  }

  const bothEs = format === 'es';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Schema diff</h1>
          <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
            Paste two <code className="font-mono">CREATE TABLE</code> statements, or two
            Elasticsearch index mappings. There is no format to pick — each side is read as
            whatever you paste into it.
          </p>
        </div>
        <div className="w-56">
          {/* Greyed rather than removed when both sides are mappings. A control that
              vanishes reads as a bug; one that is visibly inapplicable explains itself. */}
          <DialectSelect
            value={dialectId}
            onChange={setDialectId}
            label="SQL dialect"
            disabled={bothEs}
            title={
              bothEs
                ? 'Both sides are Elasticsearch mappings, which are JSON — there is no SQL grammar to choose.'
                : 'Which grammar to read the CREATE TABLE statements with.'
            }
          />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SchemaPane
          step={1}
          title="Before"
          description="What you asked for."
          value={beforeText}
          onChange={setBeforeText}
          side={before}
          onSqlExample={() => setBeforeText(SQL_BEFORE)}
          onEsExample={() => setBeforeText(ES_BEFORE)}
        />
        <SchemaPane
          step={2}
          title="After"
          description="What you actually got."
          value={afterText}
          onChange={setAfterText}
          side={after}
          onSqlExample={() => setAfterText(SQL_AFTER)}
          onEsExample={() => setAfterText(ES_AFTER)}
        />
      </div>

      <Panel
        step={3}
        tone="primary"
        title="What differs"
        description={
          diff
            ? [
                `${counts.added} added`,
                `${counts.removed} removed`,
                `${counts.retyped} retyped`,
                ...(bothEs ? [`${counts.attributes} reconfigured`] : []),
                `${counts.unchanged} unchanged`,
              ].join(' · ')
            : undefined
        }
        actions={
          <>
            <Toggle checked={showUnchanged} onChange={setShowUnchanged} label="Show unchanged" />
            <Button
              variant="primary"
              onClick={sendToGenerator}
              disabled={checkable.length === 0 || bothEs}
              title={
                bothEs
                  ? 'The generator works from SQL data types; Elasticsearch types do not map onto them one for one.'
                  : 'Send the added and retyped columns to the bulk generator'
              }
            >
              Generate checks for changed columns
            </Button>
          </>
        }
      >
        {mismatched ? (
          <Note tone="warn">
            One side is a <code className="font-mono">CREATE TABLE</code> and the other is an
            Elasticsearch mapping. Comparing them would mean deciding that{' '}
            <code className="font-mono">keyword</code> equals{' '}
            <code className="font-mono">varchar</code> and so on, which is a judgement about your
            data rather than a fact about the schemas — so it is left to you. Paste two of the same
            kind.
          </Note>
        ) : !diff ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Paste a schema on both sides to see the difference.
          </p>
        ) : visible.length === 0 ? (
          <Note tone="success">
            Every field matches{bothEs ? ', types and settings alike' : ''}.
          </Note>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-card)] text-ink-500 dark:text-ink-400">
                  <th className="py-2 pr-4 font-medium">{bothEs ? 'Field' : 'Column'}</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Before</th>
                  <th className="py-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((change) => (
                  <tr
                    key={change.name}
                    className="border-b border-[var(--border-card)] align-top last:border-0"
                  >
                    <td className="py-2 pr-4 font-mono font-medium">{change.name}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${STATUS_STYLE[change.kind]}`}
                      >
                        {STATUS_LABEL[change.kind]}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-ink-500 dark:text-ink-400">
                      <Cell type={change.before} attributes={change.attributes} side="before" />
                    </td>
                    <td className="py-2 font-mono text-ink-500 dark:text-ink-400">
                      <Cell type={change.after} attributes={change.attributes} side="after" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {bothEs && (
        <Panel
          title="Index settings"
          description={
            realSettingChanges.length === 0
              ? `Matching${generatedSettings.length > 0 ? `, apart from ${generatedSettings.length} the cluster writes itself` : ''}`
              : `${realSettingChanges.length} differ${realSettingChanges.length === 1 ? 's' : ''}`
          }
          actions={
            generatedSettings.length > 0 ? (
              <Toggle
                checked={showGenerated}
                onChange={setShowGenerated}
                label="Show cluster-generated"
              />
            ) : undefined
          }
        >
          {realSettingChanges.length === 0 ? (
            <Note tone="success">
              Every setting you specified came through unchanged.
            </Note>
          ) : (
            <SettingTable rows={realSettingChanges} />
          )}

          {generatedSettings.length > 0 && showGenerated && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-ink-500 dark:text-ink-400">
                Written by Elasticsearch when the index was created, so they cannot appear in the
                mapping you sent. Never counted as differences.
              </p>
              <SettingTable rows={generatedSettings} />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

/** Parse one side, debounced, choosing the parser from what was pasted. */
function useSide(text: string, dialectId: string, set: (side: Side) => void) {
  useEffect(() => {
    const format = detect(text);

    if (format === 'unknown') {
      set({ ...EMPTY, state: text.trim() === '' ? 'idle' : 'error' });
      return;
    }

    if (format === 'es') {
      // JSON parsing is instant; no need to debounce or go async.
      const result = parseEsMapping(text);
      set(
        result.mapping
          ? {
              state: 'ready',
              format: 'es',
              columns: [],
              fields: result.mapping.fields,
              settings: result.mapping.settings,
              index: result.mapping.index,
            }
          : { ...EMPTY, state: 'error', format: 'es', error: result.error },
      );
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      parseDdl(text, dialectId)
        .then((r) => {
          if (cancelled) return;
          set({ ...EMPTY, state: 'ready', format: 'sql', columns: r.columns });
        })
        .catch(() => {
          if (!cancelled) set({ ...EMPTY, state: 'error', format: 'sql' });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, dialectId, set]);
}

/**
 * What this side was read as.
 *
 * The format is detected rather than chosen, which is less friction but invisible —
 * someone looking for a format selector needs to see the answer somewhere, or they
 * conclude the tool cannot do it.
 */
function FormatBadge({ side }: { side: Side }) {
  if (side.state === 'idle') return null;

  const [label, style] =
    side.format === 'es'
      ? ['Elasticsearch mapping', 'bg-accent-500/15 text-accent-700 dark:text-accent-400']
      : side.format === 'sql'
        ? ['SQL DDL', 'bg-accent-500/15 text-accent-700 dark:text-accent-400']
        : ['Not recognised', 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'];

  return (
    <span className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${style}`}>{label}</span>
  );
}

function SchemaPane({
  step,
  title,
  description,
  value,
  onChange,
  side,
  onSqlExample,
  onEsExample,
}: {
  step: number;
  title: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
  side: Side;
  onSqlExample: () => void;
  onEsExample: () => void;
}) {
  return (
    <Panel
      step={step}
      title={title}
      description={description}
      actions={
        <>
          <FormatBadge side={side} />
          <Button variant="ghost" onClick={onSqlExample}>
            SQL example
          </Button>
          <Button variant="ghost" onClick={onEsExample}>
            Index example
          </Button>
        </>
      }
    >
      <PasteArea value={value} onChange={onChange} rows={10} minHeight="26vh" />

      {side.state === 'ready' && (
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
          {side.format === 'es'
            ? `${side.fields.length} field${side.fields.length === 1 ? '' : 's'}${side.index ? ` in ${side.index}` : ''}`
            : `${side.columns.length} column${side.columns.length === 1 ? '' : 's'}`}
        </p>
      )}

      {side.state === 'error' && (
        <div className="mt-3">
          <Note tone="warn">
            {side.error ??
              'Could not read that. Expected a CREATE TABLE statement or an Elasticsearch index mapping.'}
          </Note>
        </div>
      )}
    </Panel>
  );
}

/**
 * A type, plus the settings that differ where the type itself did not.
 *
 * The attribute lines are the whole point for an index mapping: a field with the right
 * type but a missing normalizer looks correct in a type-only comparison and behaves
 * differently at query time.
 */
function Cell({
  type,
  attributes,
  side,
}: {
  type?: string;
  attributes?: EsAttributeChange[];
  side: 'before' | 'after';
}) {
  return (
    <>
      <span>{type ?? '—'}</span>
      {attributes && attributes.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {attributes.map((a) => {
            const value = side === 'before' ? a.before : a.after;
            return (
              <li key={a.key}>
                <span className="text-ink-400 dark:text-ink-500">{a.key}: </span>
                {value === undefined ? (
                  <em className="text-ink-400 not-italic dark:text-ink-500">not set</em>
                ) : (
                  <span>{value}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function SettingTable({ rows }: { rows: EsSettingChange[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-[var(--border-card)] text-ink-500 dark:text-ink-400">
            <th className="py-2 pr-4 font-medium">Setting</th>
            <th className="py-2 pr-4 font-medium">Before</th>
            <th className="py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-[var(--border-card)] last:border-0">
              <td className="py-2 pr-4 font-mono">{row.key}</td>
              <td className="py-2 pr-4 font-mono text-ink-500 dark:text-ink-400">
                {row.before ?? <em className="not-italic">not set</em>}
              </td>
              <td className="py-2 font-mono text-ink-500 dark:text-ink-400">
                {row.after ?? <em className="not-italic">not set</em>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
