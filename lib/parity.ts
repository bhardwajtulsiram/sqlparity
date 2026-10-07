/**
 * Parity Run: prove that a migrated table holds the same data as its source.
 *
 * Both files are loaded into DuckDB as `parity_source` and `parity_target`, and every
 * figure in the result comes from a SQL statement built here. Building the statements
 * as plain strings, in one place, does two jobs: the run can be shown and repeated
 * exactly (the sign-off report prints every statement), and the logic can be tested
 * against a real engine without a browser.
 *
 * Two ways to line rows up:
 *
 *   key   Rows are matched on one or more key columns. Gives the richest answer —
 *         which keys are missing on each side, and for matched rows, which columns
 *         disagree and on how many rows.
 *   rows  No key: each side is treated as a multiset of rows and compared with
 *         EXCEPT ALL. Says how many rows exist on one side and not the other, but
 *         cannot say which column changed, because without a key nothing pairs a
 *         source row with its target row.
 */

export const SOURCE_TABLE = 'parity_source';
export const TARGET_TABLE = 'parity_target';

export interface ColumnInfo {
  name: string;
  /** DuckDB's type name, as DESCRIBE reports it. */
  type: string;
}

/** A source column and the target column it should hold the same values as. */
export interface ColumnPair {
  source: string;
  target: string;
  sourceType: string;
  targetType: string;
}

export interface ParityOptions {
  /** Ignore leading and trailing whitespace in text. */
  trim: boolean;
  /** Compare text case-insensitively. */
  ignoreCase: boolean;
  /** Treat an empty string as NULL, the commonest loader difference of all. */
  emptyAsNull: boolean;
  /** Numbers within this distance count as equal. 0 means exact. */
  tolerance: number;
}

export const DEFAULT_OPTIONS: ParityOptions = {
  trim: false,
  ignoreCase: false,
  emptyAsNull: false,
  tolerance: 0,
};

export interface ParitySpec {
  /** Empty means compare as multisets of rows. */
  keys: ColumnPair[];
  compare: ColumnPair[];
  options: ParityOptions;
}

export type ParityMode = 'key' | 'rows';

export function modeOf(spec: ParitySpec): ParityMode {
  return spec.keys.length > 0 ? 'key' : 'rows';
}

/* ----------------------------------------------------------- column pairing */

/** Case and punctuation folded, so `CustomerID` pairs with `customer_id`. */
function loose(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Pair source columns with target columns by name.
 *
 * Exact names first, then case-insensitive, then with punctuation ignored — each
 * pass only considers columns the earlier passes left unpaired, so an exact match is
 * never displaced by a looser one.
 */
export function autoPair(
  source: ColumnInfo[],
  target: ColumnInfo[],
): { pairs: ColumnPair[]; onlySource: string[]; onlyTarget: string[] } {
  const pairs: ColumnPair[] = [];
  const usedTarget = new Set<string>();
  const pairedSource = new Set<string>();

  const passes: ((name: string) => string)[] = [(n) => n, (n) => n.toLowerCase(), loose];
  for (const fold of passes) {
    for (const s of source) {
      if (pairedSource.has(s.name)) continue;
      const match = target.find((t) => !usedTarget.has(t.name) && fold(t.name) === fold(s.name));
      if (match) {
        pairs.push({ source: s.name, target: match.name, sourceType: s.type, targetType: match.type });
        pairedSource.add(s.name);
        usedTarget.add(match.name);
      }
    }
  }

  // Keep the source file's column order, which is the order a reader expects.
  const order = new Map(source.map((c, i) => [c.name, i]));
  pairs.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));

  return {
    pairs,
    onlySource: source.filter((c) => !pairedSource.has(c.name)).map((c) => c.name),
    onlyTarget: target.filter((c) => !usedTarget.has(c.name)).map((c) => c.name),
  };
}

const KEY_NAME = /(^id$|_id$|^id_|key$|^code$|_code$|_no$|_number$|^uuid$|_uuid$)/i;

/**
 * Choose a key from the columns that are unique and never null in the source.
 *
 * `unique` is what the engine measured. Among those, a column named like an
 * identifier wins over one that just happens to be unique in this sample — a
 * timestamp column is often unique in a small file and is a terrible key.
 */
export function pickKey(pairs: ColumnPair[], unique: ReadonlySet<string>): ColumnPair | undefined {
  const candidates = pairs.filter((p) => unique.has(p.source));
  return (
    candidates.find((p) => p.source.toLowerCase() === 'id') ??
    candidates.find((p) => KEY_NAME.test(p.source)) ??
    undefined
  );
}

/* --------------------------------------------------------------- expressions */

/** Double-quote an identifier for DuckDB. */
export function q(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL(\(\d+,\s*\d+\))?)$/i;

export function isNumeric(type: string): boolean {
  return NUMERIC.test(type.trim());
}

export function isText(type: string): boolean {
  return /^VARCHAR/i.test(type.trim());
}

/**
 * The value one side of a pair is compared as.
 *
 * Numbers on both sides compare as numbers, so 1.50 and 1.5 agree. Matching
 * non-text types compare natively. Anything else — text, or two different types —
 * compares as text, with the chosen normalisation applied. Comparing a DATE to a
 * TIMESTAMP as text will report a difference, which is right: the migration changed
 * the type, and the per-column table says so separately.
 */
export function valueExpr(alias: string, column: string, type: string, otherType: string, options: ParityOptions): string {
  const ref = `${alias}.${q(column)}`;
  if (isNumeric(type) && isNumeric(otherType)) return ref;
  if (type === otherType && !isText(type)) return ref;

  let expr = isText(type) ? ref : `CAST(${ref} AS VARCHAR)`;
  if (options.trim) expr = `trim(${expr})`;
  if (options.ignoreCase) expr = `lower(${expr})`;
  if (options.emptyAsNull) expr = `nullif(${expr}, '')`;
  return expr;
}

/** True when the pair is compared numerically and the tolerance applies. */
export function usesTolerance(pair: ColumnPair, options: ParityOptions): boolean {
  return options.tolerance > 0 && isNumeric(pair.sourceType) && isNumeric(pair.targetType);
}

/**
 * Floating-point slack added to a tolerance. On DOUBLE columns 1840.50 - 1840.49 is
 * 0.0100000000000477, so a 0.01 tolerance compared exactly would still flag the
 * difference it was set to forgive.
 */
const EPSILON = 1e-9;

/** The condition that is true on a row where the pair disagrees. NULL equals NULL. */
export function mismatchPredicate(pair: ColumnPair, options: ParityOptions): string {
  const s = valueExpr('s', pair.source, pair.sourceType, pair.targetType, options);
  const t = valueExpr('t', pair.target, pair.targetType, pair.sourceType, options);
  if (usesTolerance(pair, options)) {
    return `((${s} IS NULL) <> (${t} IS NULL) OR abs(${s} - ${t}) > ${options.tolerance} + ${EPSILON})`;
  }
  return `${s} IS DISTINCT FROM ${t}`;
}

/**
 * A key column as it is joined on. Keys of different types — an INTEGER id migrated
 * to VARCHAR — are compared as text, so 7 and '7' still meet.
 */
export function keyExpr(alias: string, column: string, type: string, otherType: string): string {
  const ref = `${alias}.${q(column)}`;
  return type === otherType ? ref : `CAST(${ref} AS VARCHAR)`;
}

function sourceKeyExprs(spec: ParitySpec, alias = 's'): string[] {
  return spec.keys.map((k) => keyExpr(alias, k.source, k.sourceType, k.targetType));
}

function targetKeyExprs(spec: ParitySpec, alias = 't'): string[] {
  return spec.keys.map((k) => keyExpr(alias, k.target, k.targetType, k.sourceType));
}

function joinCondition(spec: ParitySpec): string {
  const s = sourceKeyExprs(spec);
  const t = targetKeyExprs(spec);
  return s.map((expr, i) => `${expr} = ${t[i]}`).join(' AND ');
}

/* ------------------------------------------------------------------ queries */

export interface NamedQuery {
  /** What the statement measures, for the report. */
  label: string;
  sql: string;
}

export function rowCountQuery(): NamedQuery {
  return {
    label: 'Row counts',
    sql: `SELECT\n  (SELECT count(*) FROM ${SOURCE_TABLE}) AS source_rows,\n  (SELECT count(*) FROM ${TARGET_TABLE}) AS target_rows`,
  };
}

/** Duplicate and NULL keys on each side, which make key matching ambiguous. */
export function keyHealthQuery(spec: ParitySpec): NamedQuery {
  const side = (table: string, cols: string[]) => {
    const list = cols.map(q).join(', ');
    const anyNull = cols.map((c) => `${q(c)} IS NULL`).join(' OR ');
    const allPresent = cols.map((c) => `${q(c)} IS NOT NULL`).join(' AND ');
    return {
      duplicates: `(SELECT count(*) FROM (SELECT ${list} FROM ${table} WHERE ${allPresent} GROUP BY ${list} HAVING count(*) > 1))`,
      nulls: `(SELECT count(*) FROM ${table} WHERE ${anyNull})`,
    };
  };
  const s = side(SOURCE_TABLE, spec.keys.map((k) => k.source));
  const t = side(TARGET_TABLE, spec.keys.map((k) => k.target));
  return {
    label: 'Duplicate and empty keys',
    sql: [
      'SELECT',
      `  ${s.duplicates} AS source_duplicate_keys,`,
      `  ${s.nulls} AS source_null_keys,`,
      `  ${t.duplicates} AS target_duplicate_keys,`,
      `  ${t.nulls} AS target_null_keys`,
    ].join('\n'),
  };
}

/** The distinct, non-null keys of each side, as CTEs named sk and tk. */
function keySets(spec: ParitySpec): string {
  const sExprs = sourceKeyExprs(spec, 's');
  const tExprs = targetKeyExprs(spec, 't');
  const sCols = sExprs.map((e, i) => `${e} AS k${i}`).join(', ');
  const tCols = tExprs.map((e, i) => `${e} AS k${i}`).join(', ');
  const sPresent = spec.keys.map((k) => `s.${q(k.source)} IS NOT NULL`).join(' AND ');
  const tPresent = spec.keys.map((k) => `t.${q(k.target)} IS NOT NULL`).join(' AND ');
  return [
    'WITH',
    `  sk AS (SELECT DISTINCT ${sCols} FROM ${SOURCE_TABLE} s WHERE ${sPresent}),`,
    `  tk AS (SELECT DISTINCT ${tCols} FROM ${TARGET_TABLE} t WHERE ${tPresent})`,
  ].join('\n');
}

function keyJoin(spec: ParitySpec, left: string, right: string): string {
  return spec.keys.map((_, i) => `${left}.k${i} = ${right}.k${i}`).join(' AND ');
}

/** How many keys appear on both sides, and how many on only one. */
export function coverageQuery(spec: ParitySpec): NamedQuery {
  return {
    label: 'Key coverage',
    sql: [
      keySets(spec),
      'SELECT',
      '  count(*) FILTER (WHERE sk.k0 IS NOT NULL AND tk.k0 IS NOT NULL) AS matched_keys,',
      '  count(*) FILTER (WHERE tk.k0 IS NULL) AS only_in_source,',
      '  count(*) FILTER (WHERE sk.k0 IS NULL) AS only_in_target',
      `FROM sk FULL OUTER JOIN tk ON ${keyJoin(spec, 'sk', 'tk')}`,
    ].join('\n'),
  };
}

/** Sample keys present on one side only, in key order so a re-run lists the same ones. */
export function missingKeysQuery(spec: ParitySpec, side: 'source' | 'target', limit: number): NamedQuery {
  const [have, lack] = side === 'source' ? ['sk', 'tk'] : ['tk', 'sk'];
  const cols = spec.keys.map((_, i) => `${have}.k${i}`).join(', ');
  return {
    label: side === 'source' ? 'Keys only in the source' : 'Keys only in the target',
    sql: [
      keySets(spec),
      `SELECT ${cols}`,
      `FROM ${have} LEFT JOIN ${lack} ON ${keyJoin(spec, have, lack)}`,
      `WHERE ${lack}.k0 IS NULL`,
      `ORDER BY ${cols}`,
      `LIMIT ${limit}`,
    ].join('\n'),
  };
}

/**
 * One pass over the matched rows, counting disagreements for every compared column.
 *
 * Columns are aliased c0, c1… rather than by name, so a column called anything at
 * all — spaces, quotes, a reserved word — cannot break the statement.
 */
export function columnDiffQuery(spec: ParitySpec): NamedQuery {
  const counts = spec.compare.map(
    (pair, i) => `  count(*) FILTER (WHERE ${mismatchPredicate(pair, spec.options)}) AS c${i}`,
  );
  return {
    label: 'Column differences on matched rows',
    sql: [
      'SELECT',
      [`  count(*) AS compared_rows`, ...counts].join(',\n'),
      `FROM ${SOURCE_TABLE} s`,
      `JOIN ${TARGET_TABLE} t ON ${joinCondition(spec)}`,
    ].join('\n'),
  };
}

/** Example rows where one column disagrees, showing the values as stored. */
export function columnSampleQuery(spec: ParitySpec, index: number, limit: number): NamedQuery {
  const pair = spec.compare[index]!;
  const keys = spec.keys.map((k, i) => `s.${q(k.source)} AS k${i}`).join(', ');
  const order = spec.keys.map((_, i) => `k${i}`).join(', ');
  return {
    label: `Examples where ${pair.source} differs`,
    sql: [
      `SELECT ${keys}, s.${q(pair.source)} AS source_value, t.${q(pair.target)} AS target_value`,
      `FROM ${SOURCE_TABLE} s`,
      `JOIN ${TARGET_TABLE} t ON ${joinCondition(spec)}`,
      `WHERE ${mismatchPredicate(pair, spec.options)}`,
      `ORDER BY ${order}`,
      `LIMIT ${limit}`,
    ].join('\n'),
  };
}

/** The compared columns of one side, normalised, for the row-multiset comparison. */
function rowProjection(spec: ParitySpec, side: 'source' | 'target'): string {
  return spec.compare
    .map((pair, i) => {
      const expr =
        side === 'source'
          ? valueExpr('s', pair.source, pair.sourceType, pair.targetType, spec.options)
          : valueExpr('t', pair.target, pair.targetType, pair.sourceType, spec.options);
      // Both sides must agree on a type for EXCEPT; differing types are already text.
      return `${expr} AS c${i}`;
    })
    .join(', ');
}

/** Without a key: rows present on one side and not the other, counting duplicates. */
export function rowSetQuery(spec: ParitySpec): NamedQuery {
  const s = `SELECT ${rowProjection(spec, 'source')} FROM ${SOURCE_TABLE} s`;
  const t = `SELECT ${rowProjection(spec, 'target')} FROM ${TARGET_TABLE} t`;
  return {
    label: 'Rows present on one side only',
    sql: [
      'SELECT',
      `  (SELECT count(*) FROM (${s} EXCEPT ALL ${t})) AS only_in_source,`,
      `  (SELECT count(*) FROM (${t} EXCEPT ALL ${s})) AS only_in_target`,
    ].join('\n'),
  };
}

/** Example rows from one side that have no identical row on the other. */
export function rowSampleQuery(spec: ParitySpec, side: 'source' | 'target', limit: number): NamedQuery {
  const s = `SELECT ${rowProjection(spec, 'source')} FROM ${SOURCE_TABLE} s`;
  const t = `SELECT ${rowProjection(spec, 'target')} FROM ${TARGET_TABLE} t`;
  const [first, second] = side === 'source' ? [s, t] : [t, s];
  const order = spec.compare.map((_, i) => `c${i}`).join(', ');
  return {
    label: side === 'source' ? 'Rows only in the source' : 'Rows only in the target',
    sql: `SELECT * FROM (${first} EXCEPT ALL ${second})\nORDER BY ${order}\nLIMIT ${limit}`,
  };
}

/** Which columns are unique and never null, to suggest a key. */
export function uniquenessQuery(table: string, columns: string[]): string {
  const parts = columns.flatMap((c, i) => [
    `count(DISTINCT ${q(c)}) AS d${i}`,
    `count(${q(c)}) AS n${i}`,
  ]);
  return `SELECT count(*) AS total${parts.length ? ', ' + parts.join(', ') : ''} FROM ${table}`;
}

/* ------------------------------------------------------------------ verdict */

export interface ColumnOutcome {
  pair: ColumnPair;
  mismatches: number;
  /** Raw values, already formatted for display. */
  samples: { key: string[]; source: string; target: string }[];
}

export interface ParityResult {
  mode: ParityMode;
  sourceRows: number;
  targetRows: number;
  /** Key mode only. */
  keys?: {
    sourceDuplicates: number;
    targetDuplicates: number;
    sourceNulls: number;
    targetNulls: number;
    matched: number;
    onlySource: number;
    onlyTarget: number;
    /** Joined row pairs the column counts were taken over. */
    comparedRows: number;
  };
  /** Rows mode only. */
  rowSets?: { onlySource: number; onlyTarget: number };
  columns: ColumnOutcome[];
  /** Sample keys (key mode) or sample rows (rows mode) present on one side only. */
  onlySourceSamples: string[][];
  onlyTargetSamples: string[][];
  /** Columns that exist on one side and were not compared. */
  unpairedSource: string[];
  unpairedTarget: string[];
  /** Paired columns the user chose to leave out of the comparison. */
  excluded: string[];
  queries: NamedQuery[];
  engineVersion: string;
  elapsedMs: number;
}

export type Verdict = 'match' | 'match-with-gaps' | 'differs';

export interface Assessment {
  verdict: Verdict;
  /** One line per problem, in the order a reader should deal with them. */
  findings: string[];
  /** Caveats that do not make the data differ but limit what was proved. */
  gaps: string[];
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Turn the measured figures into a verdict a reviewer can sign.
 *
 * "Match" is reserved for the case where every check passed and every column was
 * compared. Matching on the columns that were compared, with some left out, is a
 * different statement and gets a different verdict, so a report can never say more
 * than the run proved.
 */
export function assess(result: ParityResult, options: ParityOptions): Assessment {
  const findings: string[] = [];
  const gaps: string[] = [];

  if (result.sourceRows !== result.targetRows) {
    findings.push(
      `Row counts differ: ${plural(result.sourceRows, 'row')} in the source, ${plural(result.targetRows, 'row')} in the target.`,
    );
  }

  if (result.keys) {
    const k = result.keys;
    if (k.onlySource > 0) findings.push(`${plural(k.onlySource, 'key')} in the source ${k.onlySource === 1 ? 'is' : 'are'} missing from the target.`);
    if (k.onlyTarget > 0) findings.push(`${plural(k.onlyTarget, 'key')} in the target ${k.onlyTarget === 1 ? 'does' : 'do'} not exist in the source.`);
    if (k.sourceDuplicates > 0) findings.push(`${plural(k.sourceDuplicates, 'key')} ${k.sourceDuplicates === 1 ? 'appears' : 'appear'} more than once in the source.`);
    if (k.targetDuplicates > 0) findings.push(`${plural(k.targetDuplicates, 'key')} ${k.targetDuplicates === 1 ? 'appears' : 'appear'} more than once in the target.`);
    if (k.sourceNulls > 0) findings.push(`${plural(k.sourceNulls, 'source row')} ${k.sourceNulls === 1 ? 'has' : 'have'} an empty key and could not be matched.`);
    if (k.targetNulls > 0) findings.push(`${plural(k.targetNulls, 'target row')} ${k.targetNulls === 1 ? 'has' : 'have'} an empty key and could not be matched.`);
  }

  if (result.rowSets) {
    const r = result.rowSets;
    if (r.onlySource > 0) findings.push(`${plural(r.onlySource, 'source row')} ${r.onlySource === 1 ? 'has' : 'have'} no identical row in the target.`);
    if (r.onlyTarget > 0) findings.push(`${plural(r.onlyTarget, 'target row')} ${r.onlyTarget === 1 ? 'has' : 'have'} no identical row in the source.`);
  }

  for (const column of result.columns) {
    if (column.mismatches > 0) {
      findings.push(`${column.pair.source}: ${plural(column.mismatches, 'matched row')} ${column.mismatches === 1 ? 'holds' : 'hold'} a different value.`);
    }
  }

  if (result.unpairedSource.length > 0) {
    gaps.push(`Not compared, only in the source: ${result.unpairedSource.join(', ')}.`);
  }
  if (result.unpairedTarget.length > 0) {
    gaps.push(`Not compared, only in the target: ${result.unpairedTarget.join(', ')}.`);
  }
  if (result.excluded.length > 0) {
    gaps.push(`Left out of the comparison by choice: ${result.excluded.join(', ')}.`);
  }
  if (result.columns.length === 0) gaps.push('No columns were compared, only keys and row counts.');

  const relaxed = [
    options.trim && 'surrounding whitespace ignored',
    options.ignoreCase && 'text compared ignoring case',
    options.emptyAsNull && 'empty text treated as NULL',
    options.tolerance > 0 && `numbers within ${options.tolerance} treated as equal`,
  ].filter(Boolean) as string[];
  if (relaxed.length > 0) gaps.push(`Compared with ${relaxed.join(', ')}.`);

  if (result.mode === 'rows') {
    gaps.push('No key was chosen, so rows were compared whole: a changed value shows as one row missing and one row extra.');
  }

  const verdict: Verdict =
    findings.length > 0
      ? 'differs'
      : result.unpairedSource.length > 0 ||
          result.unpairedTarget.length > 0 ||
          result.excluded.length > 0 ||
          result.columns.length === 0
        ? 'match-with-gaps'
        : 'match';

  return { verdict, findings, gaps };
}
