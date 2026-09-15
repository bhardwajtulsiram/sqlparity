'use client';

import { useMemo, useState } from 'react';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { DEFAULT_FORMAT, formatSql, type FormatSettings, type KeywordCase } from '@/lib/format';
import { lintSql } from '@/lib/lint';
import { usePersistentState } from '@/lib/settings';
import { SqlEditor } from '@/components/SqlEditor';
import { supportsValidation } from '@/lib/validate';
import {
  Button,
  CopyButton,
  DialectSelect,
  Disclosure,
  Field,
  Note,
  NumberInput,
  Panel,
  Segmented,
  Toggle,
  WarningList,
} from '@/components/ui';

const EXAMPLE = `select a.customer_id, b.customer_id, a.customer_segment, b.customer_segment from input_db a, output_db b where a.customer_id = b.customer_id and coalesce(a.customer_segment,'1') <> coalesce(b.customer_segment,'1') limit 10`;

const CASE_OPTIONS: { value: KeywordCase; label: string }[] = [
  { value: 'preserve', label: 'Keep' },
  { value: 'upper', label: 'UPPER' },
  { value: 'lower', label: 'lower' },
];

export function SqlFormatterTool() {
  const [input, setInput] = useState(EXAMPLE);
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);
  const [settings, setSettings] = usePersistentState<FormatSettings>('format', DEFAULT_FORMAT);

  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const outcome = useMemo(() => formatSql(input, dialect, settings), [input, dialect, settings]);
  const safetyFindings = useMemo(() => lintSql(input, dialect), [input, dialect]);

  const patch = (next: Partial<FormatSettings>) => setSettings({ ...settings, ...next });

  return (
    <div className="space-y-5">
      {/* Title shares the band with the handful of settings people actually reach for. */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] px-5 py-4 shadow-[var(--shadow-card)]">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SQL formatter</h1>
          <p className="mt-1 text-[13px] text-ink-500 dark:text-ink-400">
            Format SQL for 16 dialects. Nothing is uploaded.
          </p>
        </div>
        <div className="w-56">
          <DialectSelect value={dialectId} onChange={setDialectId} label="Format as" />
        </div>
        <Segmented
          label="Keywords"
          value={settings.keywordCase}
          onChange={(v) => patch({ keywordCase: v })}
          options={CASE_OPTIONS}
        />
        <Segmented
          label="Commas"
          value={settings.commaPosition}
          onChange={(v) => patch({ commaPosition: v })}
          options={[
            { value: 'trailing', label: 'Trailing' },
            { value: 'leading', label: 'Leading' },
          ]}
        />
        <div className="w-28">
          <Field label="Indent">
            <NumberInput
              value={settings.tabWidth}
              onChange={(v) => patch({ tabWidth: v })}
              min={1}
              max={12}
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title="Your SQL"
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
            placeholderText="Paste SQL here"
            complete
            minHeight="50vh"
            lint
          />
          {!supportsValidation(dialectId) && (
            <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
              Syntax checking isn&apos;t available for {dialect.label} — formatting still works.
            </p>
          )}
          <WarningList warnings={safetyFindings.map((f) => ({ level: 'warn' as const, message: f.message }))} />
        </Panel>

        <Panel
          step={2}
          tone="primary"
          title="Formatted"
          actions={
            <>
              <Button
                variant="ghost"
                onClick={() => setInput(outcome.sql)}
                disabled={!outcome.sql || !!outcome.error}
              >
                Replace input
              </Button>
              <CopyButton text={outcome.sql} variant="primary" />
            </>
          }
        >
          <SqlEditor value={outcome.sql} dialectId={dialectId} readOnly minHeight="50vh" />
          {outcome.error && (
            <div className="mt-4">
              <Note tone="warn">
                Could not format this as {dialect.label}: {outcome.error}
              </Note>
            </div>
          )}
        </Panel>
      </div>

      <Disclosure label="More formatting options" hint="casing, spacing, line width">
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          <Segmented
            label="Data types"
            value={settings.dataTypeCase}
            onChange={(v) => patch({ dataTypeCase: v })}
            options={CASE_OPTIONS}
          />
          <Segmented
            label="Functions"
            value={settings.functionCase}
            onChange={(v) => patch({ functionCase: v })}
            options={CASE_OPTIONS}
          />
          <Segmented
            label="Identifiers"
            value={settings.identifierCase}
            onChange={(v) => patch({ identifierCase: v })}
            options={CASE_OPTIONS}
          />
          <Segmented
            label="AND / OR go at"
            value={settings.logicalOperatorNewline}
            onChange={(v) => patch({ logicalOperatorNewline: v })}
            options={[
              { value: 'before', label: 'Line start' },
              { value: 'after', label: 'Line end' },
            ]}
          />

          <Field label="Wrap expressions after" hint="characters">
            <NumberInput
              value={settings.expressionWidth}
              onChange={(v) => patch({ expressionWidth: v })}
              min={10}
              max={300}
            />
          </Field>

          <Field label="Blank lines between queries">
            <NumberInput
              value={settings.linesBetweenQueries}
              onChange={(v) => patch({ linesBetweenQueries: v })}
              min={0}
              max={10}
            />
          </Field>

          <div className="space-y-3">
            <Toggle
              checked={settings.useTabs}
              onChange={(v) => patch({ useTabs: v })}
              label="Indent with tabs"
            />
            <Toggle
              checked={settings.denseOperators}
              onChange={(v) => patch({ denseOperators: v })}
              label="Dense operators"
              hint="a=1 instead of a = 1"
            />
            <Toggle
              checked={settings.newlineBeforeSemicolon}
              onChange={(v) => patch({ newlineBeforeSemicolon: v })}
              label="Semicolon on its own line"
            />
          </div>

          <div className="space-y-3">
            <Segmented
              label="Column alignment"
              value={settings.indentStyle}
              onChange={(v) => patch({ indentStyle: v })}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'tabularLeft', label: 'Left' },
                { value: 'tabularRight', label: 'Right' },
              ]}
            />
            {settings.indentStyle !== 'standard' && (
              <p className="text-xs text-ink-500 dark:text-ink-400">
                Deprecated upstream in sql-formatter; may be removed in a future version.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-[var(--border-card)] pt-4">
          <Button onClick={() => setSettings(DEFAULT_FORMAT)}>Reset to defaults</Button>
        </div>
      </Disclosure>
    </div>
  );
}
