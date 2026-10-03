'use client';

import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import { DEFAULT_FORMAT, formatSql, type FormatSettings, type KeywordCase } from '@/lib/format';
import { lintSql } from '@/lib/lint';
import { usePersistentState } from '@/lib/settings';
import { SqlEditor } from '@/components/SqlEditor';
import { ToolHeader } from '@/components/ToolHeader';
import { EraseIcon, ResetIcon, SparkIcon } from '@/components/icons';
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

export interface SqlFormatterToolProps {
  initialDialectId?: string;
}

export function SqlFormatterTool({ initialDialectId }: SqlFormatterToolProps = {}) {
  const [input, setInput] = useState(EXAMPLE);
  const [persistentDialectId, setPersistentDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);
  const [dialectId, setDialectId] = useState<string>(initialDialectId || DEFAULT_DIALECT_ID);
  const [settings, setSettings] = usePersistentState<FormatSettings>('format', DEFAULT_FORMAT);

  useEffect(() => {
    if (!initialDialectId) {
      setDialectId(persistentDialectId);
    }
  }, [initialDialectId, persistentDialectId]);

  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const outcome = useMemo(() => formatSql(input, dialect, settings), [input, dialect, settings]);
  const safetyFindings = useMemo(() => lintSql(input, dialect), [input, dialect]);

  const patch = (next: Partial<FormatSettings>) => setSettings({ ...settings, ...next });

  const handleDialectChange = (newDialect: string) => {
    setDialectId(newDialect);
    if (!initialDialectId) setPersistentDialectId(newDialect);
  };

  return (
    <div className="space-y-5">
      {/* The toolbar holds the handful of settings people actually reach for. */}
      <ToolHeader
        href="/sql-formatter/"
        description="Format SQL for 16 dialects, with a syntax check as you type. Nothing is uploaded."
      >
        <div className="w-56">
          <DialectSelect value={dialectId} onChange={handleDialectChange} label="Format as" />
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
      </ToolHeader>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title="Your SQL"
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
          <Button icon={<ResetIcon />} onClick={() => setSettings(DEFAULT_FORMAT)}>
            Reset to defaults
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}
