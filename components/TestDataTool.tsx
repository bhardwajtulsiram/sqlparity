'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { parseDdlSync } from '@/lib/ddl';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { usePersistentState } from '@/lib/settings';
import { showEdges } from '@/lib/parity-run';
import {
  columnSpec,
  DEFAULT_TEST_DATA,
  generateRows,
  MAX_ROWS,
  toCsv,
  toInsertSql,
  toJsonLines,
  type ColumnSpec,
  type TestDataOptions,
  type ValueKind,
} from '@/lib/testdata';
import { SqlEditor } from '@/components/SqlEditor';
import { ToolHeader } from '@/components/ToolHeader';
import { DownloadIcon, EraseIcon, ResetIcon, SparkIcon } from '@/components/icons';
import { Button, CopyButton, DialectSelect, Field, Note, NumberInput, Panel, Segmented, Toggle } from '@/components/ui';

const EXAMPLE = `CREATE TABLE customers (
  customer_id   bigint        NOT NULL,
  full_name     varchar(40)   NOT NULL,
  email         varchar(120),
  country       char(2),
  balance       numeric(12,2),
  is_active     boolean,
  signup_date   date,
  last_seen     timestamp,
  notes         text
);`;

type Format = 'sql' | 'csv' | 'jsonl';

const FORMATS: { value: Format; label: string }[] = [
  { value: 'sql', label: 'SQL INSERT' },
  { value: 'csv', label: 'CSV' },
  { value: 'jsonl', label: 'JSON Lines' },
];

const KIND_LABEL: Record<ValueKind, string> = {
  integer: 'whole number',
  decimal: 'decimal',
  float: 'floating point',
  boolean: 'true / false',
  date: 'date',
  timestamp: 'timestamp',
  time: 'time',
  text: 'text',
  uuid: 'UUID',
  json: 'JSON',
  binary: 'binary',
};

const PREVIEW_ROWS = 40;

/**
 * Realistic rows and the edge cases that break code, generated from a CREATE TABLE.
 *
 * The preview marks every deliberate edge case, and hovering one says which trap it
 * is — so when a row fails to load, or comes back changed, the reason is on screen.
 */
export function TestDataTool() {
  const [ddl, setDdl] = useState(EXAMPLE);
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);
  const [options, setOptions] = useState<TestDataOptions>(DEFAULT_TEST_DATA);
  const [format, setFormat] = useState<Format>('sql');

  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const parsed = useMemo(() => parseDdlSync(ddl, dialectId), [ddl, dialectId]);
  const specs = useMemo<ColumnSpec[]>(() => parsed.columns.map(columnSpec), [parsed]);
  const rows = useMemo(() => (specs.length > 0 ? generateRows(specs, options) : []), [specs, options]);
  const table = parsed.table ?? 'test_data';

  const output = useMemo(() => {
    if (rows.length === 0) return '';
    if (format === 'csv') return toCsv(specs, rows);
    if (format === 'jsonl') return toJsonLines(specs, rows);
    return toInsertSql(table, specs, rows, dialect);
  }, [format, specs, rows, table, dialect]);

  const edgeCount = rows.reduce((sum, row) => sum + row.filter((c) => c.edge).length, 0);

  const download = () => {
    const ext = format === 'sql' ? 'sql' : format === 'csv' ? 'csv' : 'jsonl';
    const type = format === 'csv' ? 'text/csv' : format === 'jsonl' ? 'application/x-ndjson' : 'application/sql';
    const url = URL.createObjectURL(new Blob([output], { type: `${type};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${table.replace(/[^\w.-]+/g, '_')}-test-data.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="space-y-5">
      <ToolHeader
        href="/test-data-generator/"
        description="Paste a CREATE TABLE and get realistic rows plus the values that break loaders, APIs and queries — apostrophes, emoji, the longest string a column allows, leap days, the largest number a type holds. Each one is marked with the reason it is there."
      >
        <div className="w-56">
          <DialectSelect value={dialectId} onChange={setDialectId} label="Dialect" />
        </div>
        <div className="w-28">
          <Field label="Rows">
            <NumberInput value={options.rows} min={1} max={MAX_ROWS} onChange={(v) => setOptions((o) => ({ ...o, rows: v }))} />
          </Field>
        </div>
        <Segmented
          label="NULLs in other rows"
          value={String(options.nullRate)}
          onChange={(v) => setOptions((o) => ({ ...o, nullRate: Number(v) }))}
          options={[
            { value: '0', label: 'None' },
            { value: '0.1', label: '10%' },
            { value: '0.25', label: '25%' },
          ]}
        />
        <div className="w-36">
          <Field label="Seed">
            <NumberInput value={options.seed} min={0} max={2_147_483_647} onChange={(v) => setOptions((o) => ({ ...o, seed: v }))} />
          </Field>
        </div>
        <div className="self-end pb-0.5">
          <Button icon={<ResetIcon />} onClick={() => setOptions((o) => ({ ...o, seed: Math.floor(Math.random() * 1_000_000) }))}>
            New seed
          </Button>
        </div>
        <div className="ml-auto self-center">
          <Toggle
            checked={options.edgeCases}
            onChange={(v) => setOptions((o) => ({ ...o, edgeCases: v }))}
            label="Edge cases first"
            hint="Off gives plausible values only"
          />
        </div>
      </ToolHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Panel
          step={1}
          title="Table definition"
          description={
            parsed.columns.length > 0
              ? `${parsed.columns.length} column${parsed.columns.length === 1 ? '' : 's'} read${parsed.table ? ` from ${parsed.table}` : ''}.`
              : 'Paste a CREATE TABLE in any dialect.'
          }
          actions={
            <>
              <Button variant="ghost" icon={<SparkIcon />} onClick={() => setDdl(EXAMPLE)}>
                Example
              </Button>
              <Button variant="ghost" icon={<EraseIcon />} onClick={() => setDdl('')} disabled={!ddl}>
                Clear
              </Button>
            </>
          }
        >
          <SqlEditor value={ddl} onChange={setDdl} dialectId={dialectId} minHeight="300px" placeholderText="CREATE TABLE … (column type, …)" />
          {parsed.errors.length > 0 && (
            <div className="mt-3">
              <Note tone="warn">
                Part of the definition could not be read, so some columns may be missing: line {parsed.errors[0]!.line}, {parsed.errors[0]!.message}
              </Note>
            </div>
          )}
        </Panel>

        <Panel step={2} title="Columns" description="How each column is filled, and how many traps it gets.">
          {specs.length === 0 ? (
            <Note>Columns appear here once a CREATE TABLE is read.</Note>
          ) : (
            <ul className="divide-y divide-[var(--border-card)]">
              {specs.map((spec, i) => {
                const edges = rows.filter((r) => r[i]?.edge).length;
                return (
                  <li key={spec.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px]">
                    <span className="font-mono font-semibold">{spec.name}</span>
                    <span className="font-mono text-[12px] text-ink-400">{spec.type.toLowerCase()}</span>
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {spec.isKey && <Pill tone="key">unique key</Pill>}
                      {!spec.nullable && !spec.isKey && <Pill tone="muted">NOT NULL</Pill>}
                      <Pill tone="muted">{KIND_LABEL[spec.kind]}</Pill>
                      {edges > 0 && <Pill tone="edge">{edges} edge case{edges === 1 ? '' : 's'}</Pill>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {rows.length > 0 && (
        <Panel
          step={3}
          tone="primary"
          title="Generated rows"
          description={`${rows.length.toLocaleString('en-US')} rows, ${edgeCount} deliberate edge cases. Hover a marked value to see why it is there.`}
        >
          <div
            className="code-scroll max-h-[28rem] overflow-auto rounded-lg border"
            style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)' }}
          >
            <table className="w-full border-collapse font-mono text-[12.5px]">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: 'var(--code-header)', color: 'var(--syn-comment)' }}>
                  <th className="px-3 py-2 text-right font-normal">#</th>
                  {specs.map((s) => (
                    <th key={s.name} className="px-3 py-2 text-left font-normal whitespace-nowrap">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                  <tr key={r} className="border-t" style={{ borderColor: 'var(--code-border)' }}>
                    <td className="px-3 py-1.5 text-right" style={{ color: 'var(--syn-comment)' }}>
                      {r + 1}
                    </td>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        title={cell.edge ? `Edge case: ${cell.edge}` : undefined}
                        className={`max-w-[16rem] truncate px-3 py-1.5 whitespace-pre ${cell.edge ? 'cursor-help' : ''}`}
                        style={{
                          color: cell.value === null ? 'var(--syn-comment)' : cell.edge ? 'var(--syn-number)' : 'var(--syn-plain)',
                          background: cell.edge ? 'oklch(0.86 0.11 82 / 0.07)' : undefined,
                        }}
                      >
                        {cell.value === null ? 'NULL' : cell.value === '' ? '‹empty›' : showEdges(cell.value.replace(/\n/g, '↵').replace(/\t/g, '⇥'))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > PREVIEW_ROWS && (
            <p className="mt-2 text-[12.5px] text-ink-500 dark:text-ink-400">
              Showing the first {PREVIEW_ROWS} of {rows.length.toLocaleString('en-US')} rows. The download has them all.
            </p>
          )}
        </Panel>
      )}

      {rows.length > 0 && (
        <Panel
          step={4}
          title="Output"
          actions={
            <>
              <Segmented value={format} onChange={setFormat} options={FORMATS} />
              <CopyButton text={output} />
              <Button variant="primary" icon={<DownloadIcon />} onClick={download}>
                Download
              </Button>
            </>
          }
        >
          {format === 'sql' ? (
            <SqlEditor value={output} readOnly dialectId={dialectId} minHeight="240px" />
          ) : (
            <pre
              className="code-scroll max-h-[22rem] overflow-auto rounded-lg border p-3.5 font-mono text-[12.5px] leading-relaxed whitespace-pre"
              style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-plain)' }}
            >
              {output.length > 60_000 ? `${output.slice(0, 60_000)}\n… (the download has the rest)` : output}
            </pre>
          )}
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500 dark:text-ink-400">
            {format === 'sql'
              ? `Written for ${dialect.label}: its quoting, string escaping and literal forms${dialect.id === 'transactsql' ? ', with N-prefixed text so accented and non-Latin values survive' : ''}.`
              : format === 'csv'
                ? 'RFC 4180 CSV: values with commas, quotes or line breaks are quoted; NULL is an empty field and an empty string is "".'
                : 'One JSON object per line; numbers and booleans are JSON values, NULL is null.'}{' '}
            Load it into both systems, then compare them with <Link href="/parity-run/" className="font-medium text-accent-700 hover:underline dark:text-accent-400">Parity Run</Link>.
          </p>
        </Panel>
      )}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'key' | 'muted' | 'edge'; children: React.ReactNode }) {
  const style = {
    key: 'bg-accent-500/12 text-accent-700 dark:text-accent-300',
    muted: 'bg-ink-500/10 text-ink-500 dark:text-ink-400',
    edge: 'bg-amber-500/12 text-amber-800 dark:text-amber-300',
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${style}`}>{children}</span>;
}
