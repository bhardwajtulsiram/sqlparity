'use client';

import { useMemo, useRef, useState } from 'react';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import {
  MAX_IN_VALUES,
  SEPARATOR_LABELS,
  applyCleanup,
  buildInList,
  detectSeparator,
  parseInLists,
  splitValues,
  DEFAULT_BUILD,
  DEFAULT_CLEANUP,
  type CleanupOptions,
  type OutputShape,
  type Separator,
  type Warning,
} from '@/lib/inlist';
import type { ValueMode } from '@/lib/escape';
import { usePersistentState } from '@/lib/settings';
import { decodeShareState } from '@/lib/share';
import { ShareButton } from '@/components/ShareButton';
import { ToolHeader } from '@/components/ToolHeader';
import { EraseIcon, UploadIcon } from '@/components/icons';
import {
  Button,
  CopyButton,
  DialectSelect,
  Disclosure,
  Field,
  Note,
  NumberInput,
  Panel,
  PasteArea,
  Segmented,
  TextInput,
  Toggle,
  WarningList,
} from '@/components/ui';

const EXAMPLE = `customer_id_0012
customer_id_0034
Acme, Inc.
O'Brien Holdings
007
customer_id_0034`;

export interface InListBuilderProps {
  initialDialectId?: string;
  initialChunking?: boolean;
  initialChunkSize?: number;
  initialInput?: string;
  initialShape?: OutputShape;
  initialColumnName?: string;
}

export function InListBuilder({
  initialDialectId,
  initialChunking,
  initialChunkSize,
  initialInput,
  initialShape,
  initialColumnName,
}: InListBuilderProps = {}) {
  const [input, setInput] = useState(initialInput || EXAMPLE);
  const [reverse, setReverse] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [dialectId, setDialectId] = usePersistentState('dialect', initialDialectId || DEFAULT_DIALECT_ID);
  const [valueMode, setValueMode] = usePersistentState<ValueMode>('inlist.valueMode', 'auto');
  const [shape, setShape] = usePersistentState<OutputShape>('inlist.shape', initialShape || DEFAULT_BUILD.shape);
  const [columnName, setColumnName] = usePersistentState('inlist.column', initialColumnName || DEFAULT_BUILD.columnName);
  const [cleanup, setCleanup] = usePersistentState<CleanupOptions>(
    'inlist.cleanup',
    DEFAULT_CLEANUP,
  );
  const [chunking, setChunking] = usePersistentState('inlist.chunking', initialChunking ?? false);
  const [chunkSize, setChunkSize] = usePersistentState('inlist.chunkSize', initialChunkSize ?? 1000);
  const [wrapping, setWrapping] = usePersistentState('inlist.wrapping', true);
  const [wrapAt, setWrapAt] = usePersistentState('inlist.wrapAt', DEFAULT_BUILD.wrapAt);

  // Restore shared state from URL hash (#share=...) if present
  useMemo(() => {
    // Intentionally run synchronously on initial render if window exists
    if (typeof window !== 'undefined' && window.location.hash) {
      const decoded = decodeShareState<{
        input?: string;
        dialectId?: string;
        shape?: OutputShape;
        columnName?: string;
        chunking?: boolean;
        chunkSize?: number;
        valueMode?: ValueMode;
      }>(window.location.hash);
      if (decoded) {
        if (decoded.input !== undefined) setInput(decoded.input);
        if (decoded.dialectId) setDialectId(decoded.dialectId);
        if (decoded.shape) setShape(decoded.shape);
        if (decoded.columnName) setColumnName(decoded.columnName);
        if (decoded.chunking !== undefined) setChunking(decoded.chunking);
        if (decoded.chunkSize) setChunkSize(decoded.chunkSize);
        if (decoded.valueMode) setValueMode(decoded.valueMode);
      }
    }
  }, []);

  // null = follow auto-detection; otherwise the user has overridden it.
  const [separatorOverride, setSeparatorOverride] = useState<Separator | null>(null);

  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const detection = useMemo(() => detectSeparator(input), [input]);
  const separator = separatorOverride ?? detection.separator;

  const result = useMemo(() => {
    if (reverse) {
      const { values, lists } = parseInLists(input, dialect);
      const warnings: Warning[] =
        lists > 1
          ? [
              {
                level: 'warn',
                message: `That holds ${lists} IN lists. These are the values of the first one — paste the others on their own to read them.`,
              },
            ]
          : [];
      return {
        output: values.join('\n'),
        valueCount: values.length,
        warnings,
        report: null,
      };
    }

    const raw = splitValues(input, separator);
    const report = applyCleanup(raw, cleanup);
    const build = buildInList(report.values, {
      dialect,
      valueMode,
      shape,
      columnName,
      chunkSize: chunking ? chunkSize : 0,
      wrapAt: wrapping ? wrapAt : 0,
    });

    const warnings = [...build.warnings];
    if (report.header !== undefined) {
      warnings.unshift({
        level: 'info',
        message: `Left out the first line, "${report.header}", as a column heading. Turn off "Skip a header row" under More options to keep it.`,
      });
    }
    if (build.valueCount > MAX_IN_VALUES) {
      warnings.unshift({
        level: 'warn',
        message: `${build.valueCount.toLocaleString()} values is above the ${MAX_IN_VALUES.toLocaleString()} this tool is built for. It will still generate, but the page may become slow.`,
      });
    }
    return { output: build.output, valueCount: build.valueCount, warnings, report };
  }, [
    input,
    reverse,
    separator,
    cleanup,
    dialect,
    valueMode,
    shape,
    columnName,
    chunking,
    chunkSize,
    wrapping,
    wrapAt,
  ]);

  function loadFile(file: File) {
    file.text().then((text) => {
      setInput(text);
      setSeparatorOverride(null);
    });
  }

  const removed = result.report ? result.report.blanksRemoved + result.report.duplicatesRemoved : 0;
  const cleanupOn = cleanup.trim || cleanup.dropBlank || cleanup.dedupe;
  const advancedHint = [
    valueMode !== 'auto' ? valueMode : null,
    cleanupOn ? 'cleanup on' : null,
    chunking ? 'chunked' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-5">
      {/* The toolbar holds the two choices that change what you get. */}
      <ToolHeader
        href="/in-list-builder/"
        description={
          <>
            Paste a column of values and get a quoted, escaped{' '}
            <code className="font-mono text-[13px]">IN (…)</code> clause — apostrophes,
            backslashes and leading zeros included.
          </>
        }
        status={
          <ShareButton
            getState={() => ({
              input,
              dialectId,
              shape,
              columnName,
              chunking,
              chunkSize,
              valueMode,
            })}
            label="Share List"
          />
        }
      >
        <div className="w-56">
          <DialectSelect value={dialectId} onChange={setDialectId} label="Quote it for" />
        </div>
        <Segmented
          label="Give me"
          value={shape}
          onChange={setShape}
          options={[
            { value: 'in', label: 'IN (…)' },
            { value: 'bare', label: 'Just the values' },
            { value: 'where', label: 'WHERE …' },
          ]}
        />
        {shape === 'where' && (
          <div className="w-48">
            <Field label="Column name">
              <TextInput value={columnName} onChange={setColumnName} mono />
            </Field>
          </div>
        )}
        <div className="ml-auto">
          <Toggle
            checked={reverse}
            onChange={setReverse}
            label="Reverse"
            hint="IN list back to plain values"
          />
        </div>
      </ToolHeader>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          step={1}
          title={reverse ? 'Paste an existing IN list' : 'Paste your values'}
          description={
            reverse
              ? 'A bare list, IN (...), or a full WHERE clause.'
              : `One per line, or comma or tab separated.`
          }
          actions={
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.csv,.tsv,text/plain,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadFile(file);
                  e.target.value = '';
                }}
              />
              <Button variant="ghost" icon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
                Upload
              </Button>
              <Button variant="ghost" icon={<EraseIcon />} onClick={() => setInput('')} disabled={!input}>
                Clear
              </Button>
            </>
          }
        >
          <PasteArea
            value={input}
            onChange={(next) => {
              setInput(next);
              setSeparatorOverride(null);
            }}
            rows={15}
            minHeight="46vh"
            placeholder="Paste values here, one per line"
          />

          {!reverse && input.trim() !== '' && (
            <div className="mt-4">
              {detection.confident && !separatorOverride ? (
                <p className="text-xs text-ink-500 dark:text-ink-400">
                  Reading as <strong>{SEPARATOR_LABELS[separator].toLowerCase()}</strong> —{' '}
                  {result.valueCount.toLocaleString()} values.
                </p>
              ) : (
                <Note tone="warn">
                  <p>{detection.reason}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <span>Read it as:</span>
                    {([detection.separator, ...detection.alternatives].filter(
                      (s, i, arr) => arr.indexOf(s) === i,
                    ) as Separator[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setSeparatorOverride(option)}
                        className={`rounded-md px-2.5 py-1 font-medium ${
                          separator === option
                            ? 'bg-accent-600 text-white'
                            : 'border border-current/30 hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        {SEPARATOR_LABELS[option]}
                      </button>
                    ))}
                  </div>
                </Note>
              )}
            </div>
          )}
        </Panel>

        <Panel
          step={2}
          tone="primary"
          title={reverse ? 'Your values' : 'Your IN clause'}
          description={
            result.valueCount === 0
              ? 'Paste something on the left.'
              : `${result.valueCount.toLocaleString()} value${result.valueCount === 1 ? '' : 's'}${
                  removed > 0 ? ` · ${removed} removed by cleanup` : ''
                }`
          }
          actions={<CopyButton text={result.output} label="Copy" variant="primary" />}
        >
          <PasteArea
            value={result.output}
            rows={15}
            minHeight="46vh"
            readOnly
            placeholder="Output appears here"
          />
          <WarningList warnings={result.warnings} />
        </Panel>
      </div>

      <Disclosure label="More options" hint={advancedHint || 'quoting, cleanup, chunking'}>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          <Segmented
            label="Quoting"
            value={valueMode}
            onChange={setValueMode}
            options={[
              { value: 'auto', label: 'Auto', title: 'Quote everything except plain numbers' },
              { value: 'string', label: 'Text', title: 'Quote every value' },
              { value: 'numeric', label: 'Numbers', title: 'Leave numbers unquoted' },
            ]}
          />

          <div className="space-y-3">
            <span className="block text-[13px] font-medium text-ink-700 dark:text-ink-300">
              Clean up the list
            </span>
            <Toggle
              checked={cleanup.dropHeader !== false}
              onChange={(v) => setCleanup({ ...cleanup, dropHeader: v })}
              label="Skip a header row"
            />
            <Toggle
              checked={cleanup.trim}
              onChange={(v) => setCleanup({ ...cleanup, trim: v })}
              label="Trim whitespace"
            />
            <Toggle
              checked={cleanup.dropBlank}
              onChange={(v) => setCleanup({ ...cleanup, dropBlank: v })}
              label="Drop blanks"
            />
            <Toggle
              checked={cleanup.dedupe}
              onChange={(v) => setCleanup({ ...cleanup, dedupe: v })}
              label="Remove duplicates"
            />
          </div>

          <Segmented
            label="Letter case"
            value={cleanup.caseMode}
            onChange={(v) => setCleanup({ ...cleanup, caseMode: v })}
            options={[
              { value: 'preserve', label: 'Keep' },
              { value: 'lower', label: 'lower' },
              { value: 'upper', label: 'UPPER' },
            ]}
          />

          <div className="space-y-4">
            <Toggle
              checked={chunking}
              onChange={setChunking}
              label="Split into chunks"
              hint={
                dialect.maxInListSize
                  ? `${dialect.label} allows at most ${dialect.maxInListSize}`
                  : 'For very long lists'
              }
            />
            {chunking && (
              <Field label="Values per chunk">
                <NumberInput value={chunkSize} onChange={setChunkSize} min={1} />
              </Field>
            )}
            <Toggle checked={wrapping} onChange={setWrapping} label="Wrap long lines" />
            {wrapping && (
              <Field label="Values per line">
                <NumberInput value={wrapAt} onChange={setWrapAt} min={1} max={500} />
              </Field>
            )}
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
