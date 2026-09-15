'use client';

import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import {
  sql,
  MSSQL,
  MariaSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
} from '@codemirror/lang-sql';
import { supportsValidation, validateSql, warmValidator } from '@/lib/validate';

/**
 * CodeMirror ships a handful of SQL dialects for highlighting. Anything it does not
 * know falls back to StandardSQL — highlighting is cosmetic here, and correctness
 * comes from the dialect registry, not from the editor's tokenizer.
 */
const CM_DIALECTS: Record<string, typeof StandardSQL> = {
  mysql: MySQL,
  mariadb: MariaSQL,
  tidb: MySQL,
  postgresql: PostgreSQL,
  redshift: PostgreSQL,
  duckdb: PostgreSQL,
  transactsql: MSSQL,
  plsql: PLSQL,
  sqlite: SQLite,
};

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '10px 0' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'color-mix(in oklab, currentColor 40%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, currentColor 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-diagnostic-error': { borderLeftColor: 'oklch(0.58 0.22 25)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy oklch(0.58 0.22 25)',
    textDecorationSkipInk: 'none',
  },
});

export interface SqlEditorApi {
  /** The text the user currently has selected, or '' when the selection is empty. */
  getSelection: () => string;
  /**
   * The editor's current document.
   *
   * CodeMirror observes contenteditable input through a MutationObserver, so a mirror
   * of the text kept in React state can lag the document by a tick — long enough for a
   * keyboard shortcut fired straight after typing to act on the previous text. Anything
   * that executes what is on screen should read it from here.
   */
  getText: () => string;
}

/** A validation input plus the map back to real document positions. See lib/validate.ts. */
export interface LintPrepared {
  probeSql: string;
  mapOffset: (probeOffset: number) => number;
}

function lineColToFlatOffset(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i]!.length + 1;
  return Math.min(offset + Math.max(0, column - 1), text.length);
}

/**
 * Builds the CM6 lint source for a given dialect.
 *
 * `prepare` is read through a ref (passed in by the caller) rather than closed over
 * directly, so a new function identity on every render of the parent does not force
 * the whole editor to be torn down and rebuilt — only the lint pass itself needs the
 * latest version.
 */
function sqlLintSource(dialectId: string, prepareRef: { current?: (text: string) => LintPrepared }) {
  return async (view: EditorView): Promise<Diagnostic[]> => {
    if (!supportsValidation(dialectId)) return [];
    const text = view.state.doc.toString();
    if (text.trim() === '') return [];

    const prepared = prepareRef.current?.(text) ?? { probeSql: text, mapOffset: (n: number) => n };

    let errors;
    try {
      errors = await validateSql(prepared.probeSql, dialectId);
    } catch {
      // A parser failure should never surface as a broken editor — just show nothing.
      return [];
    }

    const docLen = view.state.doc.length;
    return errors.map((e): Diagnostic => {
      const probeFrom = lineColToFlatOffset(prepared.probeSql, e.line, e.column);
      const probeTo = lineColToFlatOffset(prepared.probeSql, e.endLine, e.endColumn);
      const from = Math.min(prepared.mapOffset(probeFrom), docLen);
      let to = Math.min(prepared.mapOffset(Math.max(probeTo, probeFrom + 1)), docLen);
      if (to <= from) to = Math.min(from + 1, docLen);
      return { from, to, severity: 'error', message: e.message };
    });
  };
}

export function SqlEditor({
  value,
  onChange,
  dialectId,
  readOnly = false,
  minHeight = '260px',
  placeholderText,
  apiRef,
  lint = false,
  lintPrepare,
}: {
  value: string;
  onChange?: (next: string) => void;
  dialectId: string;
  readOnly?: boolean;
  minHeight?: string;
  placeholderText?: string;
  apiRef?: { current: SqlEditorApi | null };
  /** Opt in to inline syntax checking (only available for a few dialects; see lib/validate.ts). */
  lint?: boolean;
  /** Transform the document before validating it — used to probe a {{templated}} query. */
  lintPrepare?: (text: string) => LintPrepared;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lintPrepareRef = useRef(lintPrepare);
  lintPrepareRef.current = lintPrepare;

  // Rebuild only when something structural changes; value updates are dispatched.
  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      highlightActiveLine(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      sql({ dialect: CM_DIALECTS[dialectId] ?? StandardSQL, upperCaseKeywords: false }),
      EditorView.lineWrapping,
      theme,
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
      }),
    ];
    if (placeholderText) extensions.push(placeholder(placeholderText));
    if (lint && supportsValidation(dialectId)) {
      extensions.push(
        linter(sqlLintSource(dialectId, lintPrepareRef), { delay: 400 }),
        lintGutter(),
      );
      // Pay the one-time ANTLR grammar cost now, while the page is otherwise idle,
      // rather than on the user's first keystroke.
      warmValidator(dialectId);
    }

    const instance = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    view.current = instance;

    if (apiRef) {
      apiRef.current = {
        getSelection: () => {
          const { from, to } = instance.state.selection.main;
          return from === to ? '' : instance.state.sliceDoc(from, to);
        },
        getText: () => instance.state.doc.toString(),
      };
    }

    return () => {
      instance.destroy();
      view.current = null;
      if (apiRef) apiRef.current = null;
    };
    // `value` is intentionally excluded: it is the initial document only, and later
    // changes are applied by the effect below without tearing down the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialectId, readOnly, placeholderText, lint]);

  // Apply external value changes (formatting, presets, clearing) without disturbing
  // the cursor when the document already matches.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return (
    <div
      ref={host}
      style={{ minHeight }}
      className="overflow-auto rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)]"
    />
  );
}
