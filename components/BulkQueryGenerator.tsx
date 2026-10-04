'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DIALECT_ID, getDialect } from '@/lib/dialects';
import {
  IGNORED_COLUMN,
  MAX_TEMPLATE_ROWS,
  TYPE_COLUMN,
  extractPlaceholders,
  generate,
  markVariable,
  type IterationMode,
  type Variable,
  type VariableKind,
} from '@/lib/generate';
import {
  PRESETS,
  combineQueries,
  getPreset,
  presetCombine,
  presetTemplate,
  presetUnavailable,
} from '@/lib/presets';
import { nameForList } from '@/lib/identifiers';
import { columnsToGrid, looksLikeDdl, parseDdl, type DdlColumn, type DdlParseResult } from '@/lib/ddl';
import { lintSql } from '@/lib/lint';
import { probeTemplate, supportsValidation } from '@/lib/validate';
import { checkFieldsAgainstSchema } from '@/lib/schema-check';
import { takeFieldsHandoff } from '@/lib/handoff';
import {
  defaultTypeMap,
  effectiveTypeMap,
  normalizeType,
  resolveType,
  type TypeMap,
} from '@/lib/typemap';
import { downloadExcel, downloadNumberedSet, downloadSqlFile } from '@/lib/export';
import { usePersistentState } from '@/lib/settings';
import { decodeShareState } from '@/lib/share';
import { ShareButton } from '@/components/ShareButton';
import { SqlEditor, type SqlEditorApi } from '@/components/SqlEditor';
import { ToolHeader } from '@/components/ToolHeader';
import { DownloadIcon } from '@/components/icons';
import {
  Button,
  ColumnBox,
  CopyButton,
  DialectSelect,
  Disclosure,
  Field,
  Note,
  Panel,
  PasteArea,
  Segmented,
  Select,
  TextInput,
  WarningList,
} from '@/components/ui';

const PAGE_SIZE = 25;
const DEFAULT_PRESET = 'column-comparison-sentinel';
/** Bump when stored templates or variables change shape. See the hydration effect. */
const TEMPLATE_SCHEMA = 2;

const EXAMPLE_NAMES = `customer_segment
order_count
last_order_at
is_active
lifetime_value`;

const EXAMPLE_TYPES = `varchar
bigint
timestamp
boolean
double`;

/**
 * Loading this is how most people will discover that DDL is accepted at all — the
 * banner it triggers explains the feature better than any label could.
 */
const EXAMPLE_DDL = `CREATE EXTERNAL TABLE IF NOT EXISTS prod_db.customer_snapshot (
  customer_id string,
  customer_segment varchar(50),
  order_count bigint,
  last_order_at timestamp,
  is_active boolean,
  lifetime_value double,
  amount decimal(38,9)
)
STORED AS PARQUET
LOCATION 's3://bucket/path/';`;

/** Plain-English names for the variables presets ship with. */
const FRIENDLY_LABELS: Record<string, string> = {
  table_a: 'Input table',
  table_b: 'Output table',
  key: 'Join key column',
  row_limit: 'Rows to show',
  schema: 'Schema',
  schema_a: 'Input schema',
  schema_b: 'Output schema',
  field: 'Field',
  table: 'Table',
  null_default: 'Null placeholder',
  in_field: 'Input column',
  out_field: 'Output column',
  field_out: 'Output column names',
  key_out: 'Output join key',
};

function friendlyLabel(name: string): string {
  const known = FRIENDLY_LABELS[name];
  if (known) return known;
  return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const KIND_LABELS: Record<VariableKind, string> = {
  bulk: 'From your list',
  constant: 'Same every time',
  typed: 'From the data type',
};

export function BulkQueryGenerator() {
  const [dialectId, setDialectId] = usePersistentState('dialect', DEFAULT_DIALECT_ID);
  const [presetId, setPresetId] = usePersistentState('gen.preset', DEFAULT_PRESET);
  // Persisted, so a hand-edited template and the table names filled into its
  // variables survive a refresh. Both hydrate from storage after the first render,
  // which is why the preset-loading effect below waits on their `hydrated` flags —
  // loading a preset before storage has been read would overwrite the restored edit.
  const [template, setTemplate, templateHydrated] = usePersistentState('gen.template', '');
  const [variables, setVariables, variablesHydrated] = usePersistentState<Variable[]>(
    'gen.variables',
    [],
  );
  // The preset text the stored template was loaded from. Comparing against this,
  // rather than against the preset's *current* text, is what distinguishes "never
  // edited" from "edited" — a shipped preset that changes would otherwise make every
  // untouched stored template look hand-edited, and it would then be preserved
  // forever and never pick up the change.
  const [templateSource, setTemplateSource] = usePersistentState('gen.templateSource', '');
  // Bumped when the shape of a stored template or its variables changes in a way
  // older storage cannot be reconciled with.
  const [schema, setSchema, schemaHydrated] = usePersistentState('gen.schema', 0);
  const [mode, setMode] = usePersistentState<IterationMode>('gen.mode', 'rowwise');
  // Three separate lists rather than one tab-separated grid. They pair by position:
  // line N of each box describes the same column. Keeping them apart lets each box
  // say what it is and what happens when it is left empty, which a single grid cannot.
  const [namesText, setNamesText] = useState(EXAMPLE_NAMES);
  const [outNamesText, setOutNamesText] = useState('');
  const [typesText, setTypesText] = useState(EXAMPLE_TYPES);
  const [typeOverrides, setTypeOverrides] = usePersistentState<TypeMap>('gen.typeMap', {});
  const [combined, setCombined] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingToken, setPendingToken] = useState('');
  const [pendingName, setPendingName] = useState('field');
  const [findToken, setFindToken] = useState('');
  const [exportNote, setExportNote] = useState('');

  // Restore shared state from URL hash (#share=...) if present
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const decoded = decodeShareState<{
        template?: string;
        dialectId?: string;
        namesText?: string;
        outNamesText?: string;
        typesText?: string;
      }>(window.location.hash);
      if (decoded) {
        if (decoded.template !== undefined) setTemplate(decoded.template);
        if (decoded.dialectId) setDialectId(decoded.dialectId);
        if (decoded.namesText !== undefined) setNamesText(decoded.namesText);
        if (decoded.outNamesText !== undefined) setOutNamesText(decoded.outNamesText);
        if (decoded.typesText !== undefined) setTypesText(decoded.typesText);
      }
    }
  }, [setTemplate, setDialectId]);

  const [ddl, setDdl] = useState<{
    state: 'idle' | 'parsing' | 'ready' | 'error';
    result?: DdlParseResult;
  }>({ state: 'idle' });

  // An optional reference schema to check the field list against. Deliberately not
  // auto-filled from a DDL pasted into the field box: a list derived from a schema
  // matches it by construction, so checking it against itself proves nothing. The
  // value is checking a list from elsewhere — a spreadsheet, a previous run, the
  // other table in the comparison — against the table you will actually run on.
  const [refDdlText, setRefDdlText] = useState('');
  const [refSchema, setRefSchema] = useState<{
    state: 'idle' | 'parsing' | 'ready' | 'error';
    columns: DdlColumn[];
    table?: string;
    /** Why it could not be read, when it could not. */
    problem?: string;
  }>({ state: 'idle', columns: [] });

  const editorApi = useRef<SqlEditorApi | null>(null);
  const dialect = useMemo(() => getDialect(dialectId), [dialectId]);
  const preset = getPreset(presetId);

  /**
   * Offer to pull columns out of a pasted CREATE TABLE. The parser is a large
   * on-demand module, so it is only loaded once the text actually looks like DDL,
   * and only after typing settles.
   */
  useEffect(() => {
    if (!looksLikeDdl(namesText)) {
      setDdl({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setDdl({ state: 'parsing' });
    const timer = setTimeout(() => {
      parseDdl(namesText, dialectId)
        .then((result) => {
          if (!cancelled) setDdl({ state: 'ready', result });
        })
        .catch(() => {
          if (!cancelled) setDdl({ state: 'error' });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [namesText, dialectId]);

  useEffect(() => {
    if (!looksLikeDdl(refDdlText)) {
      setRefSchema({ state: 'idle', columns: [] });
      return;
    }
    let cancelled = false;
    setRefSchema((prev) => ({ ...prev, state: 'parsing' }));
    const timer = setTimeout(() => {
      parseDdl(refDdlText, dialectId)
        .then((r) => {
          if (cancelled) return;
          if (r.columns.length === 0) {
            setRefSchema({ state: 'error', columns: [], problem: r.errors[0]?.message });
            return;
          }
          setRefSchema({ state: 'ready', columns: r.columns, table: r.table });
        })
        .catch(() => {
          if (!cancelled) setRefSchema({ state: 'error', columns: [] });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refDdlText, dialectId]);

  const loadPreset = useCallback((id: string, forDialect: string) => {
    const found = getPreset(id);
    if (!found) return;
    const text = presetTemplate(found, forDialect);
    setTemplate(text);
    setTemplateSource(text);
    setVariables(found.variables.map((v) => ({ ...v })));
    setCombined(false);
    setPage(0);
  }, []);

  /**
   * Is the template still the preset's own text, or has it been edited?
   *
   * Derived rather than stored: a flag would have to be kept in sync with every edit,
   * every preset load and every restore, and would be wrong the moment one of those
   * missed it. Comparing against the preset's pristine text cannot drift.
   */
  const templateIsCustom =
    template.trim() !== '' && templateSource !== '' && template !== templateSource;

  // Read inside the effect below without making it a dependency — otherwise it would
  // re-run on every keystroke just to short-circuit.
  const templateRef = useRef(template);
  templateRef.current = template;
  const isCustomRef = useRef(templateIsCustom);
  isCustomRef.current = templateIsCustom;
  const sourceRef = useRef(templateSource);
  sourceRef.current = templateSource;
  const variablesRef = useRef(variables);
  variablesRef.current = variables;

  const seen = useRef<{ presetId: string; dialectId: string } | null>(null);
  const forcePresetLoad = useRef(false);

  useEffect(() => {
    // Wait for storage: acting before hydration would clobber a restored template.
    if (!templateHydrated || !variablesHydrated || !schemaHydrated) return;

    const first = seen.current === null;
    const presetChanged = !first && seen.current!.presetId !== presetId;
    const dialectChanged = !first && seen.current!.dialectId !== dialectId;
    seen.current = { presetId, dialectId };

    if (first) {
      const stored = templateRef.current;
      const untouched = stored.trim() === '' || stored === sourceRef.current;

      // Storage written before the current schema cannot be told apart from an edit,
      // so it is refreshed from the preset once. Everything else — dialect, type map,
      // format settings — is left alone.
      const stale = schema !== TEMPLATE_SCHEMA;

      if (forcePresetLoad.current || untouched || stale) {
        forcePresetLoad.current = false;
        loadPreset(presetId, dialectId);
        if (stale) setSchema(TEMPLATE_SCHEMA);
        return;
      }

      // A genuinely hand-edited template is kept, but still gains any variable the
      // preset has since added, so new fields appear rather than silently going
      // missing.
      const found = getPreset(presetId);
      if (found) {
        const known = new Set(variablesRef.current.map((v) => v.name));
        const missing = found.variables.filter((v) => !known.has(v.name));
        if (missing.length > 0) {
          setVariables([...variablesRef.current, ...missing.map((v) => ({ ...v }))]);
        }
      }
      return;
    }

    // Picking a different check always loads it — that is the whole point of picking
    // it. Changing dialect reloads the preset's variant for that dialect too, but not
    // over a hand-edited template: silently discarding someone's edited SQL because
    // they switched dialect is worse than leaving them SQL they may need to adjust,
    // and "Reset to the preset" is right there when they do want it replaced.
    if (presetChanged || (dialectChanged && !isCustomRef.current)) {
      loadPreset(presetId, dialectId);
    }
  }, [presetId, dialectId, templateHydrated, variablesHydrated, schemaHydrated, schema, setSchema, setVariables, loadPreset]);

  // A schema diff sends its changed columns here via sessionStorage, then navigates
  // over. Consumed once on mount; taking it clears it, so a later remount (or a plain
  // visit) never replays someone else's handoff. The preset is forced to the one with
  // a typed variable rather than trusting whatever preset was last selected — that
  // preset's loadPreset effect is what actually sets columns to [field, TYPE_COLUMN],
  // so this only needs to steer it, not duplicate its logic.
  useEffect(() => {
    const handoff = takeFieldsHandoff();
    if (handoff) {
      setPresetId(DEFAULT_PRESET);
      const pairs = handoff.split(/\r?\n/).map((line) => line.split('\t'));
      setNamesText(pairs.map((c) => c[0] ?? '').join('\n'));
      setTypesText(pairs.map((c) => c[1] ?? '').join('\n'));
      setOutNamesText('');
      // The handoff carries field+type rows shaped for the typed-variable preset, so
      // a custom template restored from a previous session should not take priority
      // over loading that preset fresh.
      forcePresetLoad.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One entry per line, trailing blank lines dropped but interior ones kept so the
   *  three lists stay aligned by position. */
  const toLines = (text: string): string[] => {
    const lines = text.split(/\r?\n/);
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
    return lines;
  };

  /**
   * How many rows a list contributes, and how many of them are blank.
   *
   * Both numbers come from the same place on purpose. An earlier version showed the
   * non-blank count but compared raw line counts, so a list with blank lines in it
   * displayed "54 names" while the mismatch check saw 57 — the number you were trying
   * to match was not the number being compared.
   */
  const statOf = (lines: string[]) => ({
    rows: lines.length,
    blanks: lines.filter((l) => l.trim() === '').length,
  });

  const names = useMemo(() => toLines(namesText), [namesText]);
  const outNames = useMemo(() => toLines(outNamesText), [outNamesText]);
  const types = useMemo(() => toLines(typesText), [typesText]);

  const nameStat = useMemo(() => statOf(names), [names]);
  const outStat = useMemo(() => statOf(outNames), [outNames]);
  const typeStat = useMemo(() => statOf(types), [types]);

  /**
   * Take a paste into the names box, splitting it when it holds several columns.
   *
   * Copying two columns out of a spreadsheet gives tab-separated rows. Left as they
   * are, each "name" would be `customer_id<TAB>varchar` and every query would be
   * broken. The second column goes where it belongs — the types box when it holds
   * types, the output names box otherwise.
   */
  const [splitNote, setSplitNote] = useState<string | null>(null);
  function acceptNames(text: string) {
    if (!text.includes('\t')) {
      setNamesText(text);
      setSplitNote(null);
      return;
    }
    const rows = text.split(/\r?\n/).map((line) => line.split('\t').map((cell) => cell.trim()));
    const width = Math.max(...rows.map((r) => r.length));
    const column = (i: number) => rows.map((r) => r[i] ?? '').join('\n');
    const looksLikeTypes = (i: number) => {
      const cells = rows.map((r) => r[i] ?? '').filter((c) => c !== '');
      const typed = cells.filter(
        (c) => resolveType(c, typeMap).missing === undefined || /[(<\[]/.test(c),
      );
      return cells.length > 0 && typed.length >= cells.length * 0.8;
    };
    setNamesText(column(0));
    const placed: string[] = [];
    for (let i = 1; i < Math.min(width, 3); i++) {
      if (looksLikeTypes(i)) {
        setTypesText(column(i));
        placed.push('data types');
      } else {
        setOutNamesText(column(i));
        placed.push('output column names');
      }
    }
    setSplitNote(
      `That paste had ${width} columns. The first went into column names${
        placed.length > 0 ? `, then ${placed.join(' and ')}` : ''
      }${width > 3 ? `; the other ${width - 3} were left out` : ''}.`,
    );
  }

  /** Drops blank lines from a list, keeping the rest in order. */
  const dropBlanks = (text: string) =>
    text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .join('\n');

  // Which variables the current template actually feeds, in the order the boxes map
  // onto them. Derived from the template rather than chosen by the user — the boxes
  // are the interface now, so there is nothing left to configure.
  const placeholders = useMemo(() => extractPlaceholders(template), [template]);

  const bulkVariables = useMemo(() => variables.filter((v) => v.kind === 'bulk'), [variables]);

  /**
   * Whether a field can actually do anything is decided by the template, not by the
   * variable list.
   *
   * A variable can exist while the template never mentions it — an edited template
   * kept across a preset change is the usual way that happens. Reading the variable
   * list alone would show an enabled, fully-styled field that silently changes
   * nothing, which is worse than showing it switched off with the reason.
   */
  const usesVariable = (name: string | undefined) => !!name && placeholders.includes(name);
  const usesOutputNames = usesVariable(bulkVariables[1]?.name);
  const usesTypes = useMemo(
    () => variables.some((v) => v.kind === 'typed' && placeholders.includes(v.name)),
    [variables, placeholders],
  );

  /** Variables the preset supplies that the current template never references. */
  const unusedFromPreset = useMemo(() => {
    const found = getPreset(presetId);
    if (!found) return [];
    return found.variables
      .filter((v) => variables.some((x) => x.name === v.name))
      .filter((v) => !placeholders.includes(v.name))
      .map((v) => v.name);
  }, [presetId, variables, placeholders]);

  const columns = useMemo(() => {
    const roleNames = bulkVariables.map((v) => v.name);
    return usesTypes ? [...roleNames, TYPE_COLUMN] : roleNames;
  }, [bulkVariables, usesTypes]);

  // A blank output name falls back to the input name, which is what makes one
  // template serve both the same-name and renamed cases.
  const grid = useMemo(() => {
    const rows = names.map((name, i) => {
      const row: string[] = [name];
      if (usesOutputNames) row.push((outNames[i] ?? '').trim() || name);
      if (usesTypes) row.push(types[i] ?? '');
      return row;
    });
    return { rows, columnCount: columns.length };
  }, [names, outNames, types, usesOutputNames, usesTypes, columns.length]);

  const roles = columns;

  const typeMap = useMemo(
    () => effectiveTypeMap(dialect, typeOverrides, {}),
    [dialect, typeOverrides],
  );


  // Linted once here rather than on every generated query — the template is what a
  // custom (non-preset) query actually looks like, and every generated statement
  // inherits whatever risk is in it.
  const templateLint = useMemo(() => lintSql(template, dialect), [template, dialect]);

  /**
   * The field list as {name, type} pairs, read through the same column-role mapping
   * the generator itself uses — so what gets checked is exactly what would be
   * generated, not a separately-parsed guess.
   */
  const listedFields = useMemo(() => {
    const bulkName = variables.find((v) => v.kind === 'bulk')?.name;
    const nameIndex = bulkName ? roles.indexOf(bulkName) : -1;
    const typeIndex = roles.indexOf(TYPE_COLUMN);
    if (nameIndex === -1) return [];
    return grid.rows
      .filter((row) => row.some((cell) => cell.trim() !== ''))
      .map((row) => ({
        name: row[nameIndex] ?? '',
        type: typeIndex === -1 ? undefined : row[typeIndex],
      }));
  }, [grid.rows, roles, variables]);

  const schemaCheck = useMemo(
    () => checkFieldsAgainstSchema(listedFields, refSchema.columns),
    [listedFields, refSchema.columns],
  );

  /**
   * What to paste, spelled out from the column roles the preset actually set up.
   * A preset comparing renamed columns wants three columns rather than two, and
   * nothing else on screen says so before you paste into the box.
   */
  /**
   * A plain-English description of what to paste, built from the same column mapping
   * the generator uses. A preset that compares renamed columns expects two name
   * lists side by side, which is not something a user would guess from a box that
   * just says "paste your fields".
   */
  const pasteInstructions = useMemo(() => {
    const named = columns.filter(Boolean);
    const parts = named.map((r) =>
      r === TYPE_COLUMN ? 'its data type' : friendlyLabel(r).toLowerCase(),
    );
    const bulkCount = named.filter((r) => r !== TYPE_COLUMN).length;

    if (bulkCount <= 1) {
      return `One row per field: ${parts.join(', then ')}. Or paste a whole CREATE TABLE and its columns are read for you.`;
    }
    return `One row per comparison: ${parts.join(', then ')} — side by side, the way copying ${named.length} columns out of a spreadsheet already gives you.`;
  }, [columns]);

  const pasteShape = useMemo(
    () =>
      // `columns`, not `roles`: roles is clamped to the width of whatever is actually
      // pasted, so it collapses to a single entry while the box is still empty —
      // exactly when this hint is the only thing telling you how many to paste.
      columns
        .filter(Boolean)
        .map((r) => (r === TYPE_COLUMN ? 'data_type' : r))
        .join('	'),
    [columns],
  );

  /**
   * Variables with blank values replaced by whatever they fall back to. Editing still
   * works on the raw list, so clearing the output join key restores the fallback
   * rather than sticking at the copied value.
   */
  const effectiveVariables = useMemo(
    () =>
      variables.map((v) => {
        if (v.kind !== 'constant' || v.value.trim() !== '' || !v.fallbackTo) return v;
        const source = variables.find((x) => x.name === v.fallbackTo);
        return { ...v, value: source?.value ?? '' };
      }),
    [variables],
  );

  const lists = useMemo(() => {
    if (mode !== 'cartesian') return {};
    const out: Record<string, string[]> = {};
    const bulkNames = variables.filter((v) => v.kind === 'bulk').map((v) => v.name);
    bulkNames.forEach((name, i) => {
      out[name] = grid.rows.map((row) => row[i] ?? '').filter((v) => v.trim() !== '');
    });
    return out;
  }, [mode, variables, grid.rows]);

  const result = useMemo(
    () =>
      generate({
        template,
        variables: effectiveVariables,
        dialect,
        typeMap,
        mode,
        columns: roles,
        rows: grid.rows,
        lists,
      }),
    [template, effectiveVariables, dialect, typeMap, mode, roles, grid.rows, lists],
  );

  const constantBindings = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of effectiveVariables) if (v.kind === 'constant') out[v.name] = v.value;
    return out;
  }, [effectiveVariables]);

  const combineSpec = preset ? presetCombine(preset, dialectId) : undefined;
  const combinedSql = useMemo(
    () =>
      combineSpec && combined ? combineQueries(result.queries, combineSpec, constantBindings) : '',
    [combineSpec, combined, result.queries, constantBindings],
  );

  const allSql = useMemo(
    () =>
      combined && combinedSql
        ? combinedSql
        : result.queries.map((q) => q.sql.trimEnd()).join(';\n\n'),
    [combined, combinedSql, result.queries],
  );

  const pageCount = Math.max(1, Math.ceil(result.queries.length / PAGE_SIZE));
  const visible = result.queries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => setPage(0), [result.queries.length]);

  const missingTypes = useMemo(() => {
    const typeIndex = roles.indexOf(TYPE_COLUMN);
    if (typeIndex === -1) return [];
    const seen = new Set<string>();
    for (const row of grid.rows) {
      const key = normalizeType(row[typeIndex] ?? '');
      if (key && typeMap[key] === undefined) seen.add(key);
    }
    return [...seen].sort();
  }, [roles, grid.rows, typeMap]);

  function setVariableKind(name: string, kind: VariableKind) {
    setVariables((prev) => prev.map((v) => (v.name === name ? { ...v, kind } : v)));
  }
  function setVariableValue(name: string, value: string) {
    setVariables((prev) => prev.map((v) => (v.name === name ? { ...v, value } : v)));
  }

  function addVariablesForUnknownPlaceholders() {
    const known = new Set(variables.map((v) => v.name));
    const missing = placeholders.filter((p) => !known.has(p));
    if (missing.length === 0) return;
    setVariables((prev) => [
      ...prev,
      ...missing.map((name): Variable => ({ name, kind: 'constant', value: '' })),
    ]);
  }

  function applyMark(token: string, name: string) {
    if (!token.trim() || !name.trim()) return;
    setTemplate((prev) => markVariable(prev, token.trim(), name.trim(), dialect));
    setVariables((prev) =>
      prev.some((v) => v.name === name.trim())
        ? prev
        : [...prev, { name: name.trim(), kind: 'bulk', value: '' }],
    );
    setPendingToken('');
    setFindToken('');
  }

  async function runExport(kind: 'sql' | 'zip' | 'xlsx') {
    setExportNote('');
    try {
      if (kind === 'sql') downloadSqlFile(result.queries);
      if (kind === 'zip') await downloadNumberedSet(result.queries);
      if (kind === 'xlsx') {
        const report = await downloadExcel(result.queries);
        if (report.truncated > 0) {
          setExportNote(
            `${report.truncated} quer${report.truncated === 1 ? 'y was' : 'ies were'} longer than Excel's ${report.limit.toLocaleString()}-character cell limit and ${report.truncated === 1 ? 'was' : 'were'} truncated in the spreadsheet. The .sql download has them in full.`,
          );
        }
      }
    } catch (err) {
      setExportNote(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const unknownPlaceholders = placeholders.filter((p) => !variables.some((v) => v.name === p));
  const constants = variables.filter((v) => v.kind === 'constant');
  const fromList = variables.filter((v) => v.kind !== 'constant');

  return (
    <div className="space-y-5">
      {/* The two top-level choices share the toolbar; the preset's explanation sits
          beneath them, where it reads as describing the choice just made. */}
      <ToolHeader
        href="/bulk-query-generator/"
        description={
          <>
            Paste a <code className="font-mono text-[13px]">CREATE TABLE</code> or a list of
            fields and get one validation query per column, with the right null placeholder for
            each data type.
          </>
        }
        status={
          <ShareButton
            getState={() => ({
              template,
              dialectId,
              namesText,
              outNamesText,
              typesText,
            })}
            label="Share Generator"
          />
        }
        footer={
          preset?.summary || preset?.detail || (preset && presetUnavailable(preset, dialectId)) ? (
            <div className="space-y-3">
              {(preset?.summary || preset?.detail) && (
                <p className="text-[13px] leading-relaxed text-ink-500 dark:text-ink-400">
                  <span className="font-medium text-ink-800 dark:text-ink-200">
                    {preset?.summary}
                  </span>{' '}
                  {preset?.detail}
                </p>
              )}
              {preset && presetUnavailable(preset, dialectId) && (
                <Note tone="warn">{presetUnavailable(preset, dialectId)}</Note>
              )}
            </div>
          ) : undefined
        }
      >
        <div className="w-full sm:w-80">
          <Field label="Check">
            <Select value={presetId} onChange={setPresetId}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-full sm:w-56">
          <DialectSelect value={dialectId} onChange={setDialectId} label="Write SQL for" />
        </div>
      </ToolHeader>

      {/* Setup on the left, results on the right and pinned, so the queries stay in
          view while the inputs above them change. */}
      <Panel
        step={1}
        title="Fill in your tables"
        description="These stay the same for every generated query."
      >
        {constants.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {constants.map((variable) => {
              const fallback = variable.fallbackTo
                ? variables.find((x) => x.name === variable.fallbackTo)
                : undefined;
              const usingFallback = !!fallback && variable.value.trim() === '';
              const used = placeholders.includes(variable.name);
              return (
                <div key={variable.name} className={used ? undefined : 'opacity-55'}>
                  <Field
                    label={friendlyLabel(variable.name)}
                    hint={
                      !used
                        ? 'The current query template never uses it.'
                        : usingFallback
                          ? `Same as ${friendlyLabel(fallback.name).toLowerCase()}${
                              fallback.value.trim() ? ` (${fallback.value.trim()})` : ''
                            }`
                          : undefined
                    }
                  >
                    <TextInput
                      value={variable.value}
                      onChange={(v) => setVariableValue(variable.name, v)}
                      placeholder={fallback ? fallback.value.trim() : undefined}
                      mono
                    />
                  </Field>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            This template has nothing to fill in.
          </p>
        )}

        {unusedFromPreset.length > 0 && (
          <div className="mt-5">
            <Note tone="warn">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Your edited template never uses{' '}
                  {unusedFromPreset.map((n) => friendlyLabel(n).toLowerCase()).join(' or ')}, so
                  {unusedFromPreset.length === 1 ? ' that field changes' : ' those fields change'}{' '}
                  nothing. The preset&apos;s own template does use{' '}
                  {unusedFromPreset.length === 1 ? 'it' : 'them'}.
                </span>
                <Button variant="primary" onClick={() => loadPreset(presetId, dialectId)}>
                  Use the preset&apos;s template
                </Button>
              </div>
            </Note>
          </div>
        )}

        {fromList.length > 0 && (
          <p className="mt-5 text-[13px] text-ink-500 dark:text-ink-400">
            {fromList.map((v, i) => (
              <span key={v.name}>
                {i > 0 && ' · '}
                <code className="font-mono text-ink-700 dark:text-ink-300">{v.name}</code>{' '}
                {v.kind === 'bulk' ? 'comes from your list' : "comes from each field's data type"}
              </span>
            ))}
          </p>
        )}

        {/* The template box and the fields box are both paste targets, and the template
            one comes first. Catch a DDL pasted into the wrong one rather than silently
            generating the same statement N times. */}
        {looksLikeDdl(template) && (
          <div className="mt-5">
            <Note tone="warn">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  That looks like a <strong>CREATE TABLE</strong>, and it is sitting in the query
                  template. It probably belongs in <strong>Column names</strong> below, where its
                  columns get read.
                </span>
                <Button
                  variant="primary"
                  onClick={() => {
                    setNamesText(template);
                    loadPreset(presetId, dialectId);
                  }}
                >
                  Move it to Column names
                </Button>
              </div>
            </Note>
          </div>
        )}

        <div className="mt-5 space-y-3">
          <Disclosure
            label="Edit the query template"
            hint={templateIsCustom ? 'edited — saved on this machine' : 'advanced'}
            defaultOpen
          >
            <SqlEditor
              value={template}
              onChange={setTemplate}
              dialectId={dialectId}
              apiRef={editorApi}
              minHeight="280px"
              placeholderText="Paste a working query, then mark the parts that vary"
              lint
              lintPrepare={probeTemplate}
            />
            {!supportsValidation(dialectId) && (
              <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                Syntax checking isn&apos;t available for {dialect.label}.
              </p>
            )}
            <WarningList
              warnings={templateLint.map((f) => ({ level: 'warn' as const, message: f.message }))}
            />

            <div className="mt-4 space-y-3 rounded-lg bg-[var(--surface-sunken)] p-4">
              <p className="text-[13px] text-ink-600 dark:text-ink-400">
                Anything in <code className="font-mono">{'{{double braces}}'}</code> gets replaced.
                To turn part of the query into a variable, select it and click below.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => {
                    const selected = editorApi.current?.getSelection() ?? '';
                    if (selected.trim()) setPendingToken(selected.trim());
                  }}
                >
                  Make selection a variable
                </Button>
                <span className="text-xs text-ink-500 dark:text-ink-400">or type a column:</span>
                <div className="w-48">
                  <TextInput
                    value={findToken}
                    onChange={setFindToken}
                    placeholder="column_name"
                    mono
                  />
                </div>
                <Button
                  onClick={() => setPendingToken(findToken.trim())}
                  disabled={!findToken.trim()}
                >
                  Use
                </Button>
              </div>

              {pendingToken && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg bg-[var(--surface-card)] p-3.5">
                  <p className="w-full text-[13px] text-ink-600 dark:text-ink-400">
                    Replace every <code className="font-mono font-semibold">{pendingToken}</code>{' '}
                    with a variable named:
                  </p>
                  <div className="w-44">
                    <TextInput value={pendingName} onChange={setPendingName} mono />
                  </div>
                  <Button variant="primary" onClick={() => applyMark(pendingToken, pendingName)}>
                    Replace
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingToken('')}>
                    Cancel
                  </Button>
                </div>
              )}

              {unknownPlaceholders.length > 0 && (
                <Note tone="warn">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Not defined yet: {unknownPlaceholders.map((p) => `{{${p}}}`).join(', ')}</span>
                    <Button onClick={addVariablesForUnknownPlaceholders}>Define them</Button>
                  </div>
                </Note>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => loadPreset(presetId, dialectId)}>
                {templateIsCustom ? 'Discard edits, reload the preset' : 'Reset to the preset'}
              </Button>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'rowwise', label: 'One query per row' },
                  { value: 'cartesian', label: 'Every combination' },
                ]}
              />
            </div>
          </Disclosure>

          <Disclosure label="Change where each variable comes from" hint="advanced">
            <div className="space-y-2">
              {variables.map((variable) => (
                <div
                  key={variable.name}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-card)] px-3.5 py-2.5"
                >
                  <code className="font-mono text-[13px] font-semibold">{`{{${variable.name}}}`}</code>
                  <div className="ml-auto w-48">
                    <Select
                      value={variable.kind}
                      onChange={(v) => setVariableKind(variable.name, v as VariableKind)}
                    >
                      {(['bulk', 'constant', 'typed'] as VariableKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </Disclosure>
        </div>
      </Panel>

      <Panel
        step={2}
        title="Paste your columns"
        description="One column per line. The boxes line up row by row."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setNamesText(EXAMPLE_NAMES);
                setOutNamesText('');
                setTypesText(EXAMPLE_TYPES);
              }}
            >
              Load an example
            </Button>
            <Button variant="ghost" onClick={() => setNamesText(EXAMPLE_DDL)}>
              Try a CREATE TABLE
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {ddl.state === 'parsing' && <Note>Reading the columns out of that CREATE TABLE…</Note>}

          {ddl.state === 'error' && (
            <Note tone="warn">Could not read that as a CREATE TABLE.</Note>
          )}

          {ddl.state === 'ready' && ddl.result && (
            <Note tone={ddl.result.columns.length > 0 && ddl.result.errors.length === 0 ? 'info' : 'warn'}>
              {ddl.result.columns.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      Found <strong>{ddl.result.columns.length}</strong> column
                      {ddl.result.columns.length === 1 ? '' : 's'}
                      {ddl.result.table ? ` in ${ddl.result.table}` : ''}.
                    </span>
                    <Button
                      variant="primary"
                      onClick={() => {
                        const cols = ddl.result!.columns;
                        setNamesText(cols.map((c) => nameForList(c.name, c.quoted, dialect)).join('\n'));
                        setTypesText(cols.map((c) => c.type).join('\n'));
                      }}
                    >
                      Fill the boxes with them
                    </Button>
                  </div>
                  {ddl.result.errors.length > 0 && (
                    <p>
                      Some of it could not be read, so columns may be missing:{' '}
                      {ddl.result.errors
                        .slice(0, 3)
                        .map((e) => `line ${e.line}: ${e.message}`)
                        .join(' · ')}
                    </p>
                  )}
                  {ddl.result.notes?.map((note) => <p key={note}>{note}</p>)}
                </div>
              ) : (
                <span>
                  No columns could be read from that
                  {ddl.result.errors[0]
                    ? ` — line ${ddl.result.errors[0].line}: ${ddl.result.errors[0].message}`
                    : '.'}
                </span>
              )}
            </Note>
          )}

          {splitNote && <Note>{splitNote}</Note>}

          <div className="grid gap-4 md:grid-cols-3">
            <ColumnBox
              label="Column names"
              help="One per line."
              value={namesText}
              onChange={acceptNames}
              count={
                nameStat.rows === 0
                  ? 'Nothing pasted yet'
                  : `${nameStat.rows} column${nameStat.rows === 1 ? '' : 's'}`
              }
              blanks={nameStat.blanks}
              onRemoveBlanks={() => setNamesText(dropBlanks(namesText))}
            />

            <ColumnBox
              label="Output column names"
              help="Only if the output table renamed them."
              value={outNamesText}
              onChange={setOutNamesText}
              optional
              disabled={!usesOutputNames}
              disabledNote="This check compares the same name in both tables."
              count={
                outStat.rows === 0
                  ? 'Same names as the left'
                  : `${outStat.rows} name${outStat.rows === 1 ? '' : 's'}`
              }
              blanks={outStat.blanks}
              onRemoveBlanks={() => setOutNamesText(dropBlanks(outNamesText))}
              mismatch={
                outStat.rows > 0 && outStat.rows !== nameStat.rows
                  ? `${outStat.rows} rows here against ${nameStat.rows} column names.`
                  : undefined
              }
            />

            <ColumnBox
              label="Data types"
              help={
                usesTypes
                  ? 'Picks the null placeholder for each column.'
                  : 'This check does not use them.'
              }
              value={typesText}
              onChange={setTypesText}
              optional={!usesTypes}
              disabled={!usesTypes}
              disabledNote="This check does not use data types."
              count={
                typeStat.rows === 0
                  ? usesTypes
                    ? 'Needed by this check'
                    : 'Not used'
                  : `${typeStat.rows} type${typeStat.rows === 1 ? '' : 's'}`
              }
              blanks={typeStat.blanks}
              onRemoveBlanks={() => setTypesText(dropBlanks(typesText))}
              mismatch={
                usesTypes && typeStat.rows > 0 && typeStat.rows !== nameStat.rows
                  ? `${typeStat.rows} rows here against ${nameStat.rows} column names.`
                  : undefined
              }
            />
          </div>
        </div>

        {missingTypes.length > 0 && (
          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700/60 dark:bg-amber-950/30">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {missingTypes.length === 1 ? 'One data type is' : `${missingTypes.length} data types are`}{' '}
              not in the type map for {dialect.label}, so the columns that have{' '}
              {missingTypes.length === 1 ? 'it' : 'them'} were left out. Give{' '}
              {missingTypes.length === 1 ? 'it' : 'them'} a value to include them.
            </p>
            <div className="mt-3 space-y-2">
              {missingTypes.map((type) => (
                <div key={type} className="flex flex-wrap items-center gap-2.5">
                  <code className="font-mono text-[13px] font-semibold">{type}</code>
                  <span className="text-xs text-ink-500 dark:text-ink-400">becomes</span>
                  <div className="w-52">
                    <TextInput
                      value={typeOverrides[type] ?? ''}
                      onChange={(v) => setTypeOverrides({ ...typeOverrides, [type]: v })}
                      placeholder="e.g. -1"
                      mono
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
              Guessing a value here would produce queries that run cleanly and report the wrong
              answer, so those columns stay out until you decide. Arrays, maps, structs and JSON
              have no safe stand-in value — the null-safe comparison preset checks them without
              one.
            </p>
          </div>
        )}

        {Object.keys(typeOverrides).length > 0 && (
          <div className="mt-5">
            <Disclosure
              label="Your saved type-map entries"
              hint={`${Object.keys(typeOverrides).length} saved`}
            >
              <div className="flex flex-wrap gap-2">
                {Object.entries(typeOverrides).map(([type, value]) => (
                  <span
                    key={type}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-card)] px-2.5 py-1.5 text-[13px]"
                  >
                    <code className="font-mono">
                      {type} → {value || '(blank)'}
                    </code>
                    <button
                      type="button"
                      aria-label={`Remove ${type}`}
                      onClick={() => {
                        const next = { ...typeOverrides };
                        delete next[type];
                        setTypeOverrides(next);
                      }}
                      className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <Button onClick={() => setTypeOverrides({})}>Reset all</Button>
              </div>
            </Disclosure>
          </div>
        )}

        <div className="mt-5">
          <Disclosure
            label="Check these fields against a schema"
            hint={
              refSchema.state === 'ready' && listedFields.length > 0
                ? schemaCheck.clean
                  ? 'all fields found'
                  : `${schemaCheck.unknown.length + schemaCheck.typeMismatches.length} to look at`
                : 'optional'
            }
          >
            <p className="mb-3 text-[13px] text-ink-600 dark:text-ink-400">
              Paste the <code className="font-mono">CREATE TABLE</code> for the table you will
              actually run these against. Any field in your list that does not exist there gets
              flagged before you generate hundreds of queries for it.
            </p>
            <PasteArea
              value={refDdlText}
              onChange={setRefDdlText}
              rows={6}
              placeholder="CREATE TABLE ... — the schema to check against"
            />

            {refSchema.state === 'parsing' && (
              <div className="mt-3">
                <Note>Reading that schema…</Note>
              </div>
            )}

            {refSchema.state === 'error' && (
              <div className="mt-3">
                <Note tone="warn">
                  Could not read that as a CREATE TABLE{refSchema.problem ? ` — ${refSchema.problem}` : '.'}
                </Note>
              </div>
            )}

            {refSchema.state === 'ready' && (
              <div className="mt-3 space-y-2">
                {listedFields.length === 0 ? (
                  <Note>
                    Read {refSchema.columns.length} column
                    {refSchema.columns.length === 1 ? '' : 's'} — paste a field list above to check
                    it against them.
                  </Note>
                ) : (
                  <>
                    {schemaCheck.clean && (
                      <Note tone="success">
                        All {schemaCheck.matched} field{schemaCheck.matched === 1 ? '' : 's'} exist
                        in {refSchema.table ?? 'that schema'}
                        {schemaCheck.typeMismatches.length === 0 ? ', with matching types.' : '.'}
                      </Note>
                    )}

                    {schemaCheck.unknown.length > 0 && (
                      <Note tone="warn">
                        <p>
                          <strong>
                            {schemaCheck.unknown.length} field
                            {schemaCheck.unknown.length === 1 ? ' is' : 's are'} not in this schema
                          </strong>{' '}
                          — queries generated for {schemaCheck.unknown.length === 1 ? 'it' : 'them'}{' '}
                          will fail when you run them.
                        </p>
                        <p className="mt-1.5 font-mono text-xs">
                          {schemaCheck.unknown.join(', ')}
                        </p>
                      </Note>
                    )}

                    {schemaCheck.typeMismatches.length > 0 && (
                      <Note tone="warn">
                        <p>
                          <strong>
                            {schemaCheck.typeMismatches.length} field
                            {schemaCheck.typeMismatches.length === 1 ? ' has' : 's have'} a
                            different type here
                          </strong>{' '}
                          — the sentinel chosen from your list would be the wrong one.
                        </p>
                        <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
                          {schemaCheck.typeMismatches.map((m) => (
                            <li key={m.name}>
                              {m.name}: your list says {m.listed}, the schema says {m.actual}
                            </li>
                          ))}
                        </ul>
                      </Note>
                    )}

                    {schemaCheck.uncovered.length > 0 && (
                      <Note>
                        {schemaCheck.uncovered.length} column
                        {schemaCheck.uncovered.length === 1 ? '' : 's'} in the schema
                        {schemaCheck.uncovered.length === 1 ? ' is' : ' are'} not in your list.
                        That is fine if you are checking a subset on purpose.
                      </Note>
                    )}
                  </>
                )}
              </div>
            )}
          </Disclosure>
        </div>
      </Panel>

      {result.problems.filter((p) => p.level === 'block' && missingTypes.length === 0).length >
        0 && (
        <div className="space-y-2">
          {result.problems
            .filter((p) => p.level === 'block')
            .map((problem, i) => (
              <Note key={i} tone="error">
                {problem.message}
              </Note>
            ))}
        </div>
      )}

      <Panel
        step={3}
        tone="primary"
        title="Your queries"
        description={
          looksLikeDdl(namesText)
            ? 'Waiting for you to read the columns from the CREATE TABLE above.'
            : result.blocked
              ? 'Fix the problem above to generate.'
              : result.queries.length === 0
                ? 'Paste a list of fields above.'
                : combined && combinedSql
                  ? 'Combined into a single query.'
                  : `${result.queries.length.toLocaleString()} quer${result.queries.length === 1 ? 'y' : 'ies'}`
        }
        actions={
          <>
            {combineSpec && (
              <Button
                onClick={() => setCombined(!combined)}
                disabled={result.queries.length === 0}
                title="Join every generated statement into one query"
              >
                {combined ? 'Show separately' : 'Combine into one'}
              </Button>
            )}
            <CopyButton text={allSql} label="Copy all" variant="primary" />
            <Button icon={<DownloadIcon />} onClick={() => runExport('sql')} disabled={!result.queries.length}>
              .sql
            </Button>
            <Button icon={<DownloadIcon />} onClick={() => runExport('zip')} disabled={!result.queries.length}>
              .zip
            </Button>
            <Button icon={<DownloadIcon />} onClick={() => runExport('xlsx')} disabled={!result.queries.length}>
              Excel
            </Button>
          </>
        }
      >
        {exportNote && (
          <div className="mb-4">
            <Note tone="warn">{exportNote}</Note>
          </div>
        )}

        {result.problems.filter((p) => p.level === 'warn').length > 0 && (
          <div className="mb-4 space-y-2">
            {result.problems
              .filter((p) => p.level === 'warn')
              .map((problem, i) => (
                <Note key={i} tone="warn">
                  {problem.message}
                </Note>
              ))}
          </div>
        )}

        {combined && combinedSql ? (
          <SqlEditor value={combinedSql} dialectId={dialectId} readOnly minHeight="60vh" />
        ) : looksLikeDdl(namesText) ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            That CREATE TABLE hasn&apos;t been read yet — click{' '}
            <strong>Use these columns</strong> above the paste box.
          </p>
        ) : result.queries.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Nothing generated yet.
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {visible.map((query) => (
                <div
                  key={query.index}
                  className="overflow-hidden rounded-lg border border-[var(--border-card)]"
                >
                  <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border-card)] bg-[var(--surface-sunken)] px-3.5 py-2 text-[13px]">
                    <span className="font-mono text-ink-400">{query.index}</span>
                    <span className="font-medium">{query.label}</span>
                    {query.dataType && (
                      <span className="rounded bg-ink-200 px-1.5 py-0.5 font-mono text-[11px] text-ink-600 dark:bg-ink-700 dark:text-ink-300">
                        {query.dataType}
                      </span>
                    )}
                    <span className="ml-auto">
                      <CopyButton text={query.sql} variant="ghost" />
                    </span>
                  </div>
                  <pre className="p-3.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                    {query.sql}
                  </pre>
                </div>
              ))}
            </div>

            {pageCount > 1 && (
              <div className="mt-5 flex items-center justify-center gap-4 text-[13px]">
                <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                  Previous
                </Button>
                <span className="text-ink-500 dark:text-ink-400">
                  Page {page + 1} of {pageCount}
                </span>
                <Button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
