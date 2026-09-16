'use client';

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
} from '@codemirror/autocomplete';
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

/**
 * Lines to mark, and how.
 *
 * The diff already knows which line each difference sits on; this paints it where the
 * reader is looking rather than making them count rows in a table and then count lines
 * in a box.
 */
export type HighlightTone = 'added' | 'removed' | 'changed';

export interface HighlightedLine {
  /** 1-based, matching what the gutter shows. */
  line: number;
  tone: HighlightTone;
}

const setHighlights = StateEffect.define<HighlightedLine[]>();

const LINE_MARK: Record<HighlightTone, ReturnType<typeof Decoration.line>> = {
  added: Decoration.line({ class: 'cm-diff-added' }),
  removed: Decoration.line({ class: 'cm-diff-removed' }),
  changed: Decoration.line({ class: 'cm-diff-changed' }),
};

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlights)) continue;
      const doc = transaction.state.doc;
      const ranges = effect.value
        // A line number past the end of the document would throw; a stale highlight
        // arriving a frame before the new text is ordinary, not exceptional.
        .filter((h) => h.line >= 1 && h.line <= doc.lines)
        .map((h) => LINE_MARK[h.tone].range(doc.line(h.line).from))
        .sort((a, b) => a.from - b.from);
      return Decoration.set(ranges);
    }
    return transaction.docChanged ? marks.map(transaction.changes) : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

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
  // Tinted the whole line width rather than just the text, so a difference is findable
  // by scrolling past it rather than by reading.
  '.cm-line.cm-diff-added': { backgroundColor: 'oklch(0.72 0.15 155 / 0.18)' },
  '.cm-line.cm-diff-removed': { backgroundColor: 'oklch(0.63 0.22 25 / 0.16)' },
  '.cm-line.cm-diff-changed': { backgroundColor: 'oklch(0.75 0.15 75 / 0.22)' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: '1px solid var(--border-card)',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: 'var(--surface-card)',
    boxShadow: 'var(--shadow-card)',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '12.5px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--color-accent-600)',
    color: '#fff',
  },
  '.cm-completionDetail': { marginLeft: '1rem', opacity: 0.6, fontStyle: 'normal' },
});

/**
 * Table and column names to offer, as table name -> column names.
 *
 * A plain record rather than CodeMirror's SQLNamespace: callers here only ever have
 * flat tables, and the narrower type keeps the conversion in one place.
 */
export type SqlSchema = Record<string, string[]>;

/** The SQL language extension for a dialect, optionally knowing about some tables. */
function sqlSupport(dialectId: string, schema?: SqlSchema, defaultTable?: string) {
  return sql({
    dialect: CM_DIALECTS[dialectId] ?? StandardSQL,
    upperCaseKeywords: false,
    ...(schema && Object.keys(schema).length > 0 ? { schema } : {}),
    // Only useful with exactly one table; with several, an unprefixed column name is
    // ambiguous and suggesting one table's columns would be a guess.
    ...(defaultTable ? { defaultTable } : {}),
  });
}

/**
 * A stable identity for a schema object.
 *
 * The caller rebuilds the record on every render, so comparing by reference would
 * reconfigure the editor on each keystroke — which closes any open completion popup.
 */
function schemaKey(schema?: SqlSchema): string {
  if (!schema) return '';
  return Object.entries(schema)
    .map(([table, columns]) => `${table}:${columns.join(',')}`)
    .join('|');
}

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
  schema,
  defaultTable,
  complete = false,
  onRun,
  language = 'sql',
  highlights,
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
  /** Tables and their columns to suggest. Changing it reconfigures in place. */
  schema?: SqlSchema;
  /** Table whose columns complete without needing the table prefix. */
  defaultTable?: string;
  /** Opt in to completion. Off by default so a template editor keeps Tab and Enter. */
  complete?: boolean;
  /**
   * Run the query. Bound to Mod-Enter inside the editor.
   *
   * This has to be a CodeMirror binding rather than a window listener: defaultKeymap
   * binds Mod-Enter to insertBlankLine, which runs on the editor element while the
   * event is still bubbling, so a preventDefault further up arrives after the blank
   * line has already been inserted.
   */
  onRun?: () => void;
  /** JSON turns off the SQL grammar, which would colour a mapping at random. */
  language?: 'sql' | 'json';
  /** Lines to tint. Applied by dispatch, so changing them does not rebuild the editor. */
  highlights?: HighlightedLine[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Holds the language extension so a new schema can be swapped in without tearing
  // the editor down, which would throw away undo history and the cursor.
  const languageSlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
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
      languageSlot.current.of(
        language === 'json' ? json() : sqlSupport(dialectId, schema, defaultTable),
      ),
      highlightField,
      EditorView.lineWrapping,
      theme,
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
      }),
    ];
    // Ahead of defaultKeymap, so this wins over insertBlankLine. Returning true tells
    // CodeMirror the key was handled, which is what suppresses the newline.
    extensions.push(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            if (!onRunRef.current) return false;
            onRunRef.current();
            return true;
          },
        },
      ]),
    );

    if (complete) {
      // defaultKeymap is off deliberately. CodeMirror binds Enter to accept a
      // completion, which in a SQL editor means pressing Enter for a newline can
      // silently insert a keyword instead. Tab accepts, and falls through to normal
      // focus movement when no popup is open, so keyboard users are not trapped.
      extensions.push(
        autocompletion({ defaultKeymap: false, icons: false, closeOnBlur: true }),
        keymap.of([
          { key: 'Tab', run: acceptCompletion },
          { key: 'Escape', run: closeCompletion },
          { key: 'ArrowDown', run: moveCompletionSelection(true) },
          { key: 'ArrowUp', run: moveCompletionSelection(false) },
          { key: 'Mod-Space', run: startCompletion },
        ]),
      );
    }
    extensions.push(keymap.of([...defaultKeymap, ...historyKeymap]));
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
  }, [dialectId, readOnly, placeholderText, lint, language]);

  // Swap in a new schema when tables are loaded or removed, in place.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({
      effects: languageSlot.current.reconfigure(
        language === 'json' ? json() : sqlSupport(dialectId, schema, defaultTable),
      ),
    });
    // The schema object is rebuilt by the caller on every render; compare its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialectId, schemaKey(schema), defaultTable, language]);

  // Paint the marked lines. A dispatch rather than a rebuild, so the cursor, the
  // selection and the undo history all survive a diff being recomputed as you type.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    instance.dispatch({ effects: setHighlights.of(highlights ?? []) });
    // Compared by content: the caller rebuilds the array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(highlights ?? [])]);

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
