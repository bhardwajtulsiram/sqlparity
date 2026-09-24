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
import { SqlEditor, type HighlightedLine } from '@/components/SqlEditor';
import { Button, DialectSelect, Note, Panel, Toggle } from '@/components/ui';
import { ToolHeader } from '@/components/ToolHeader';

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

type ChangeKind = 'added' | 'removed' | 'retyped' | 'attributes' | 'moved' | 'unchanged';

interface Change {
  name: string;
  kind: ChangeKind;
  before?: string;
  after?: string;
  attributes?: EsAttributeChange[];
}

/**
 * Everything that differs, in one list.
 *
 * Fields and index settings answer the same question — did this index come out the way
 * it was asked for — so splitting them across two tables made the reader check two
 * places and decide which mattered. `setting` and `generated` are the two row kinds a
 * field cannot be.
 */
type RowKind = ChangeKind | 'setting' | 'generated';

interface Row {
  name: string;
  kind: RowKind;
  before?: string;
  after?: string;
  attributes?: EsAttributeChange[];
  /** Where this sits in each pasted document, when the parser could tell. */
  beforeLine?: number;
  afterLine?: number;
}

const STATUS_STYLE: Record<RowKind, string> = {
  added: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  removed: 'bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-300',
  retyped: 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  attributes: 'bg-accent-500/15 text-accent-700 dark:text-accent-400',
  moved: 'bg-accent-500/15 text-accent-700 dark:text-accent-400',
  setting: 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  generated: 'text-ink-500 dark:text-ink-400',
  unchanged: 'text-ink-500 dark:text-ink-400',
};

const STATUS_LABEL: Record<RowKind, string> = {
  added: 'Added',
  removed: 'Removed',
  retyped: 'Type changed',
  attributes: 'Settings changed',
  moved: 'Position changed',
  setting: 'Setting changed',
  generated: 'Written by the cluster',
  unchanged: 'Unchanged',
};

/** Real differences first; the two kinds that are not differences sort to the bottom. */
const ROW_ORDER: Record<RowKind, number> = {
  removed: 0,
  retyped: 1,
  attributes: 2,
  added: 3,
  moved: 4,
  setting: 5,
  unchanged: 6,
  generated: 7,
};

type Format = 'sql' | 'es' | 'unknown';

interface Side {
  state: 'idle' | 'pending' | 'ready' | 'error';
  format: Format;
  /** SQL columns or Elasticsearch fields, depending on `format`. */
  columns: DdlColumn[];
  fields: EsField[];
  settings: Record<string, string>;
  settingLines: Record<string, number>;
  index?: string;
  error?: string;
  /** Parts that could not be read. The side is usable, but may be missing columns. */
  problems?: string[];
}

const EMPTY: Side = {
  state: 'idle',
  format: 'unknown',
  columns: [],
  fields: [],
  settings: {},
  settingLines: {},
};

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
    () =>
      format === 'es'
        ? diffEsSettings(
            before.settings,
            after.settings,
            before.settingLines,
            after.settingLines,
          )
        : [],
    [format, before.settings, after.settings, before.settingLines, after.settingLines],
  );

  /** Fields and settings folded into one list, sorted so real differences lead. */
  const rows = useMemo<Row[] | null>(() => {
    if (!diff) return null;
    const settingRows: Row[] = settingChanges.map((change) => ({
      name: change.key,
      kind: change.generated ? 'generated' : 'setting',
      before: change.before,
      after: change.after,
      beforeLine: change.beforeLine,
      afterLine: change.afterLine,
    }));
    return [...diff, ...settingRows].sort((a, b) => ROW_ORDER[a.kind] - ROW_ORDER[b.kind]);
  }, [diff, settingChanges]);

  // The toggle hides what is not a difference: fields that match, and the settings the
  // cluster writes itself. Both are noise by default and worth having on demand.
  const hidden = (kind: RowKind) => kind === 'unchanged' || kind === 'generated';

  const visible = useMemo(
    () => (rows ?? []).filter((r) => showUnchanged || !hidden(r.kind)),
    [rows, showUnchanged],
  );

  const counts = useMemo(() => {
    const c: Record<RowKind, number> = {
      added: 0,
      removed: 0,
      retyped: 0,
      attributes: 0,
      moved: 0,
      setting: 0,
      generated: 0,
      unchanged: 0,
    };
    for (const row of rows ?? []) c[row.kind]++;
    return c;
  }, [rows]);

  const differenceCount = (rows ?? []).filter((r) => !hidden(r.kind)).length;
  const quietCount = (rows ?? []).filter((r) => hidden(r.kind)).length;

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

  /**
   * The lines to tint in each box.
   *
   * A removed field only exists on the left and an added one only on the right, so the
   * two sides get different lists rather than one shared one — tinting a line that has
   * nothing wrong with it is worse than tinting none.
   */
  const highlightsFor = (which: 'before' | 'after'): HighlightedLine[] => {
    const marks: HighlightedLine[] = [];
    for (const row of rows ?? []) {
      if (row.kind === 'unchanged' || row.kind === 'generated') continue;
      const line = which === 'before' ? row.beforeLine : row.afterLine;
      if (line === undefined) continue;
      const tone =
        row.kind === 'added' ? 'added' : row.kind === 'removed' ? 'removed' : 'changed';
      marks.push({ line, tone });
    }
    return marks;
  };

  const beforeHighlights = useMemo(() => highlightsFor('before'), [rows]);
  const afterHighlights = useMemo(() => highlightsFor('after'), [rows]);

  const bothEs = format === 'es';

  return (
    <div className="space-y-5">
      <ToolHeader
        href="/schema-diff/"
        description={
          <>
            Paste two <code className="font-mono text-[13px]">CREATE TABLE</code> statements, or
            two Elasticsearch index mappings. There is no format to pick — each side is read as
            whatever you paste into it.
          </>
        }
        status={
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
        }
      />

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
          highlights={beforeHighlights}
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
          highlights={afterHighlights}
        />
      </div>

      <Panel
        step={3}
        tone="primary"
        title="What differs"
        description={
          rows
            ? differenceCount === 0
              ? `Nothing differs${quietCount > 0 ? ` · ${quietCount} hidden` : ''}`
              : [
                  counts.added > 0 && `${counts.added} added`,
                  counts.removed > 0 && `${counts.removed} removed`,
                  counts.retyped > 0 && `${counts.retyped} retyped`,
                  counts.attributes > 0 && `${counts.attributes} reconfigured`,
                  counts.moved > 0 && `${counts.moved} moved`,
                  counts.setting > 0 && `${counts.setting} setting${counts.setting === 1 ? '' : 's'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
            : undefined
        }
        actions={
          <>
            {quietCount > 0 && (
              <Toggle
                checked={showUnchanged}
                onChange={setShowUnchanged}
                label={`Show ${quietCount} unchanged`}
              />
            )}
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
        {!mismatched && rows && (before.problems?.length || after.problems?.length) ? (
          <div className="mb-4">
            <Note tone="warn">
              Part of the {before.problems?.length ? 'Before' : 'After'}
              {before.problems?.length && after.problems?.length ? ' and After schemas' : ' schema'}{' '}
              could not be read, so a column shown as removed or added may simply have been
              skipped. Fix the lines named under the box first.
            </Note>
          </div>
        ) : null}

        {mismatched ? (
          <Note tone="warn">
            One side is a <code className="font-mono">CREATE TABLE</code> and the other is an
            Elasticsearch mapping. Comparing them would mean deciding that{' '}
            <code className="font-mono">keyword</code> equals{' '}
            <code className="font-mono">varchar</code> and so on, which is a judgement about your
            data rather than a fact about the schemas — so it is left to you. Paste two of the same
            kind.
          </Note>
        ) : !rows ? (
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
                  <th className="py-2 pr-4 font-medium">{bothEs ? 'Field or setting' : 'Column'}</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Before</th>
                  <th className="py-2 font-medium">After</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={`${row.kind}:${row.name}`}
                    className="border-b border-[var(--border-card)] align-top last:border-0"
                  >
                    <td className="py-2 pr-4 font-mono font-medium">
                      {row.name}
                      {(row.beforeLine ?? row.afterLine) !== undefined && (
                        <span className="ml-2 text-xs font-normal text-ink-400 dark:text-ink-500">
                          {row.beforeLine !== undefined && row.afterLine !== undefined
                            ? row.beforeLine === row.afterLine
                              ? `line ${row.beforeLine}`
                              : `line ${row.beforeLine} → ${row.afterLine}`
                            : `line ${row.beforeLine ?? row.afterLine}`}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${STATUS_STYLE[row.kind]}`}
                      >
                        {STATUS_LABEL[row.kind]}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-ink-500 dark:text-ink-400">
                      <Cell type={row.before} attributes={row.attributes} side="before" />
                    </td>
                    <td className="py-2 font-mono text-ink-500 dark:text-ink-400">
                      <Cell type={row.after} attributes={row.attributes} side="after" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bothEs && counts.generated > 0 && (
          <p className="mt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            {counts.generated} settings are written by Elasticsearch when it creates the index —
            the uuid, the creation date and so on — so they cannot appear in the mapping you sent.
            They are never counted as differences.
          </p>
        )}
      </Panel>
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
              settingLines: result.mapping.settingLines,
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
          // No columns is a failure, not an empty success. The grammar reports the
          // reason; showing "0 columns" and nothing else leaves the reader guessing
          // whether the tool broke or their statement did.
          if (r.columns.length === 0) {
            set({
              ...EMPTY,
              state: 'error',
              format: 'sql',
              error: r.errors[0]
                ? `Could not read that as a CREATE TABLE — ${r.errors[0].message} (line ${r.errors[0].line}).`
                : 'Found no columns in that. Expected a CREATE TABLE statement.',
            });
            return;
          }
          const problems = [
            ...r.errors.map((e) => `Line ${e.line}: ${e.message}`),
            ...(r.notes ?? []),
          ];
          set({
            ...EMPTY,
            state: 'ready',
            format: 'sql',
            columns: r.columns,
            ...(problems.length > 0 ? { problems } : {}),
          });
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
  highlights,
}: {
  step: number;
  title: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
  side: Side;
  onSqlExample: () => void;
  onEsExample: () => void;
  highlights: HighlightedLine[];
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
      <SqlEditor
        value={value}
        onChange={onChange}
        dialectId="sql"
        language={side.format === 'es' ? 'json' : 'sql'}
        highlights={highlights}
        placeholderText="Paste a CREATE TABLE statement or an index mapping"
        minHeight="26vh"
      />

      {side.state === 'ready' && (
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
          {side.format === 'es'
            ? `${side.fields.length} field${side.fields.length === 1 ? '' : 's'}${side.index ? ` in ${side.index}` : ''}`
            : `${side.columns.length} column${side.columns.length === 1 ? '' : 's'}`}
        </p>
      )}

      {side.state === 'ready' && side.problems && side.problems.length > 0 && (
        <div className="mt-3">
          <Note tone="warn">
            <ul className="space-y-1">
              {side.problems.slice(0, 4).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Note>
        </div>
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
