import {
  columnDiffQuery,
  columnSampleQuery,
  coverageQuery,
  keyHealthQuery,
  missingKeysQuery,
  modeOf,
  rowCountQuery,
  rowSampleQuery,
  rowSetQuery,
  type ColumnOutcome,
  type NamedQuery,
  type ParityResult,
  type ParitySpec,
} from './parity';

/**
 * Run a Parity spec against whatever engine executes `query`.
 *
 * The engine is passed in rather than imported so the same code runs in the browser
 * tab against DuckDB-WASM and in the test suite against DuckDB's Node build — the
 * figures a user signs off are produced by exactly the code the tests exercise.
 */
export type QueryFn = (sql: string) => Promise<{ columns: string[]; rows: unknown[][] }>;

/** How many example rows to keep per column, and per missing side. */
export const SAMPLE_LIMIT = 5;
export const MISSING_LIMIT = 10;

/** BigInt counts, Arrow decimals and plain numbers all become a JS number. */
export function toCount(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A cell as a reader should see it in a sample or a report. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace(/\.000Z$/, '').replace(/Z$/, '');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * A sample value with its edge whitespace made visible. "Alan Turing" and
 * "Alan Turing " differ, and a reader shown both as plain text cannot see why.
 */
export function showEdges(text: string): string {
  return text.replace(/^\s+|\s+$/g, (run) =>
    run.replace(/ /g, '\u2423').replace(/\t/g, '\u21e5').replace(/\r?\n/g, '\u21b5'),
  );
}

export async function runParity(
  query: QueryFn,
  spec: ParitySpec,
  meta: { unpairedSource: string[]; unpairedTarget: string[]; excluded?: string[]; engineVersion: string },
  onProgress?: (label: string) => void,
): Promise<ParityResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ran: NamedQuery[] = [];

  const run = async (named: NamedQuery) => {
    onProgress?.(named.label);
    ran.push(named);
    return query(named.sql);
  };
  const firstRow = async (named: NamedQuery) => (await run(named)).rows[0] ?? [];

  const counts = await firstRow(rowCountQuery());
  const sourceRows = toCount(counts[0]);
  const targetRows = toCount(counts[1]);

  const mode = modeOf(spec);
  const columns: ColumnOutcome[] = spec.compare.map((pair) => ({ pair, mismatches: 0, samples: [] }));
  let keys: ParityResult['keys'];
  let rowSets: ParityResult['rowSets'];
  let onlySourceSamples: string[][] = [];
  let onlyTargetSamples: string[][] = [];

  if (mode === 'key') {
    const health = await firstRow(keyHealthQuery(spec));
    const coverage = await firstRow(coverageQuery(spec));

    let comparedRows = 0;
    if (spec.compare.length > 0) {
      const diff = await firstRow(columnDiffQuery(spec));
      comparedRows = toCount(diff[0]);
      columns.forEach((column, i) => {
        column.mismatches = toCount(diff[i + 1]);
      });
    } else {
      // Still worth knowing how many row pairs the keys produced.
      const pairs = await firstRow({
        label: 'Matched row pairs',
        sql: columnDiffQuery({ ...spec, compare: [] }).sql,
      });
      comparedRows = toCount(pairs[0]);
    }

    keys = {
      sourceDuplicates: toCount(health[0]),
      sourceNulls: toCount(health[1]),
      targetDuplicates: toCount(health[2]),
      targetNulls: toCount(health[3]),
      matched: toCount(coverage[0]),
      onlySource: toCount(coverage[1]),
      onlyTarget: toCount(coverage[2]),
      comparedRows,
    };

    for (const [i, column] of columns.entries()) {
      if (column.mismatches === 0) continue;
      const sample = await run(columnSampleQuery(spec, i, SAMPLE_LIMIT));
      column.samples = sample.rows.map((row) => ({
        key: row.slice(0, spec.keys.length).map(displayValue),
        source: showEdges(displayValue(row[spec.keys.length])),
        target: showEdges(displayValue(row[spec.keys.length + 1])),
      }));
    }

    if (keys.onlySource > 0) {
      onlySourceSamples = (await run(missingKeysQuery(spec, 'source', MISSING_LIMIT))).rows.map((r) => r.map(displayValue));
    }
    if (keys.onlyTarget > 0) {
      onlyTargetSamples = (await run(missingKeysQuery(spec, 'target', MISSING_LIMIT))).rows.map((r) => r.map(displayValue));
    }
  } else if (spec.compare.length > 0) {
    const sets = await firstRow(rowSetQuery(spec));
    rowSets = { onlySource: toCount(sets[0]), onlyTarget: toCount(sets[1]) };
    if (rowSets.onlySource > 0) {
      onlySourceSamples = (await run(rowSampleQuery(spec, 'source', MISSING_LIMIT))).rows.map((r) => r.map(displayValue));
    }
    if (rowSets.onlyTarget > 0) {
      onlyTargetSamples = (await run(rowSampleQuery(spec, 'target', MISSING_LIMIT))).rows.map((r) => r.map(displayValue));
    }
  }

  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    mode,
    sourceRows,
    targetRows,
    keys,
    rowSets,
    columns,
    onlySourceSamples,
    onlyTargetSamples,
    unpairedSource: meta.unpairedSource,
    unpairedTarget: meta.unpairedTarget,
    excluded: meta.excluded ?? [],
    queries: ran,
    engineVersion: meta.engineVersion,
    elapsedMs: ended - started,
  };
}
