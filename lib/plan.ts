import type { Dialect } from './dialects';
import { isReadOnlyQuery } from './scratchpad';
import { splitStatements } from './tokenize';

/**
 * A query plan you can read.
 *
 * The scratchpad's engine can profile a query as it runs and return the plan as JSON:
 * every operator, the rows it produced, the time it took, and what it was doing
 * (which table, which filter, which join condition). This turns that into a tree of
 * steps with plain names, folds away the bookkeeping steps a reader does not need,
 * and picks out the few things worth looking at — where the time went, a join that
 * compares every row with every row, an estimate that was far off.
 *
 * Pure: it takes the profiler's JSON and returns data, so it is tested against the
 * real engine in Node without a browser.
 */

export interface PlanStep {
  id: number;
  /** The engine's operator name, e.g. HASH_JOIN. */
  operator: string;
  /** What a person would call it. */
  label: string;
  /** One line on what this step did, from the operator's details. */
  summary: string;
  /** Every detail the engine reported, for the expanded view. */
  details: [string, string][];
  rows: number;
  /** The engine's estimate before running, where it gave one. */
  estimate?: number;
  rowsScanned: number;
  /** Time spent in this step alone, not counting its inputs. */
  ms: number;
  /** This step's share of the whole query's time, 0 to 1. */
  share: number;
  children: PlanStep[];
  /** Steps folded into this one because they only renamed or reordered columns. */
  folded: number;
}

export interface Plan {
  root: PlanStep;
  totalMs: number;
  rowsReturned: number;
  rowsScanned: number;
  insights: Insight[];
}

export interface Insight {
  tone: 'warn' | 'info';
  stepId: number;
  title: string;
  why: string;
}

interface RawNode {
  operator_name?: string;
  operator_type?: string;
  operator_timing?: number;
  operator_cardinality?: number;
  operator_rows_scanned?: number;
  extra_info?: Record<string, unknown>;
  children?: RawNode[];
}

interface RawProfile extends RawNode {
  latency?: number;
  cumulative_rows_scanned?: number;
}

const LABELS: Record<string, string> = {
  SEQ_SCAN: 'Scan table',
  TABLE_SCAN: 'Scan table',
  READ_CSV: 'Read CSV file',
  READ_CSV_AUTO: 'Read CSV file',
  READ_PARQUET: 'Read Parquet file',
  READ_JSON: 'Read JSON file',
  READ_JSON_AUTO: 'Read JSON file',
  FILTER: 'Filter rows',
  PROJECTION: 'Compute columns',
  HASH_JOIN: 'Join',
  PIECEWISE_MERGE_JOIN: 'Range join',
  IE_JOIN: 'Range join',
  NESTED_LOOP_JOIN: 'Nested-loop join',
  BLOCKWISE_NL_JOIN: 'Nested-loop join',
  CROSS_PRODUCT: 'Cross product',
  POSITIONAL_JOIN: 'Positional join',
  ASOF_JOIN: 'As-of join',
  HASH_GROUP_BY: 'Group',
  PERFECT_HASH_GROUP_BY: 'Group',
  UNGROUPED_AGGREGATE: 'Aggregate',
  SIMPLE_AGGREGATE: 'Aggregate',
  STREAMING_WINDOW: 'Window function',
  WINDOW: 'Window function',
  ORDER_BY: 'Sort',
  TOP_N: 'Sort, keep top rows',
  LIMIT: 'Limit',
  STREAMING_LIMIT: 'Limit',
  LIMIT_PERCENT: 'Limit',
  UNION: 'Union',
  UNNEST: 'Unnest',
  DISTINCT: 'Remove duplicates',
  HASH_DISTINCT: 'Remove duplicates',
  CTE: 'Common table expression',
  CTE_SCAN: 'Read CTE',
  RECURSIVE_CTE: 'Recursive CTE',
  DELIM_SCAN: 'Correlated subquery input',
  LEFT_DELIM_JOIN: 'Correlated subquery',
  RIGHT_DELIM_JOIN: 'Correlated subquery',
  DUMMY_SCAN: 'Constant row',
  COLUMN_DATA_SCAN: 'Read values',
  EMPTY_RESULT: 'Empty result',
  RESULT_COLLECTOR: 'Collect result',
};

/** Operators that only rename, reorder or compute simple columns: folded by default. */
const FOLDABLE = new Set(['PROJECTION']);

/** The bookkeeping wrapper the profiler puts around every query. */
const WRAPPERS = new Set(['EXPLAIN_ANALYZE', 'QUERY', 'RESULT_COLLECTOR']);

function label(operator: string): string {
  return LABELS[operator] ?? operator.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(', ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Internal casts and decompression wrappers say nothing to a reader. */
function tidy(expression: string): string {
  return expression
    .replace(/__internal_(?:de)?compress_\w+\((#?\w+)(?:, [^)]*)?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarise(operator: string, info: Record<string, unknown>): string {
  const get = (k: string) => (k in info ? tidy(text(info[k])) : '');
  const table = get('Table') || get('Function') || get('File Path') || get('Files');
  const parts: string[] = [];
  switch (operator) {
    case 'SEQ_SCAN':
    case 'TABLE_SCAN':
    case 'READ_CSV':
    case 'READ_CSV_AUTO':
    case 'READ_PARQUET':
    case 'READ_JSON':
    case 'READ_JSON_AUTO':
      if (table) parts.push(table.replace(/^memory\.main\./, ''));
      if (get('Filters')) parts.push(`where ${get('Filters')}`);
      break;
    case 'FILTER':
      parts.push(get('Expression') || get('Filters'));
      break;
    case 'HASH_JOIN':
    case 'NESTED_LOOP_JOIN':
    case 'PIECEWISE_MERGE_JOIN':
    case 'IE_JOIN':
    case 'BLOCKWISE_NL_JOIN':
    case 'ASOF_JOIN':
      parts.push([get('Join Type') ? `${get('Join Type').toLowerCase()} join` : '', get('Conditions')].filter(Boolean).join(' on '));
      break;
    case 'HASH_GROUP_BY':
    case 'PERFECT_HASH_GROUP_BY':
      parts.push([get('Groups') && `by ${get('Groups')}`, get('Aggregates')].filter(Boolean).join(' · '));
      break;
    case 'UNGROUPED_AGGREGATE':
      parts.push(get('Aggregates'));
      break;
    case 'ORDER_BY':
      parts.push(get('Order By'));
      break;
    case 'TOP_N':
      parts.push([get('Top') && `top ${get('Top')}`, get('Order By')].filter(Boolean).join(' by '));
      break;
    case 'PROJECTION':
      parts.push(get('Projections'));
      break;
    default:
      parts.push(
        Object.entries(info)
          .filter(([k]) => k !== 'Estimated Cardinality')
          .map(([k, v]) => `${k}: ${tidy(text(v))}`)
          .join(' · '),
      );
  }
  return parts.filter(Boolean).join(' ');
}

/** Profiler timings are in seconds; the plan uses milliseconds. */
const toMs = (seconds: number | undefined) => (seconds ?? 0) * 1000;

/**
 * Parse the JSON from `EXPLAIN (ANALYZE, FORMAT JSON) <query>`.
 *
 * `fold` merges each column-only step into the step below it, keeping the tree to
 * the steps that change what data flows; the folded count is shown so nothing is
 * hidden without saying so.
 */
export function parsePlan(json: string, fold = true): Plan {
  const raw = JSON.parse(json) as RawProfile | RawProfile[];
  const profile: RawProfile = Array.isArray(raw) ? raw[0]! : raw;

  let next = 0;
  const build = (node: RawNode): PlanStep => {
    const operator = (node.operator_name ?? node.operator_type ?? 'STEP').trim().toUpperCase().replace(/\s+/g, '_');
    const info = node.extra_info ?? {};
    const estimateText = info['Estimated Cardinality'];
    const estimate = estimateText !== undefined ? Number(String(estimateText).replace(/[^\d.]/g, '')) : undefined;
    return {
      id: next++,
      operator,
      label: label(operator),
      summary: summarise(operator, info),
      details: Object.entries(info).map(([k, v]) => [k, tidy(text(v))] as [string, string]),
      rows: node.operator_cardinality ?? 0,
      ...(estimate !== undefined && Number.isFinite(estimate) ? { estimate } : {}),
      rowsScanned: node.operator_rows_scanned ?? 0,
      ms: toMs(node.operator_timing),
      share: 0,
      children: (node.children ?? []).map(build),
      folded: 0,
    };
  };

  // Skip the profiler's own wrappers down to the query's real top step.
  let top: RawNode = profile;
  while ((top.children?.length ?? 0) === 1 && (!top.operator_name || WRAPPERS.has((top.operator_name ?? '').toUpperCase()))) {
    top = top.children![0]!;
  }
  let root = build(top);

  if (fold) {
    const collapse = (step: PlanStep): PlanStep => {
      let current = step;
      let folded = 0;
      let ms = 0;
      while (FOLDABLE.has(current.operator) && current.children.length === 1) {
        folded++;
        ms += current.ms;
        current = current.children[0]!;
      }
      return { ...current, ms: current.ms + ms, folded: current.folded + folded, children: current.children.map(collapse) };
    };
    root = collapse(root);
  }

  const steps: PlanStep[] = [];
  const walk = (s: PlanStep) => {
    steps.push(s);
    s.children.forEach(walk);
  };
  walk(root);
  const summed = steps.reduce((sum, s) => sum + s.ms, 0);
  for (const s of steps) s.share = summed > 0 ? s.ms / summed : 0;

  return {
    root,
    totalMs: toMs(profile.latency) || summed,
    rowsReturned: root.rows,
    rowsScanned: profile.cumulative_rows_scanned ?? steps.reduce((sum, s) => sum + s.rowsScanned, 0),
    insights: insights(steps),
  };
}

const n = (value: number) => Math.round(value).toLocaleString('en-US');

/** A step as a sentence's subject: a scan names its table, everything else its label. */
export function stepName(step: PlanStep): string {
  if (/SCAN|READ/.test(step.operator) && step.summary) return `${step.label.replace(/^Scan table$/, 'Scan of')} ${step.summary.split(' ')[0]}`;
  return step.label;
}

/**
 * What is worth a reader's attention, in order. Few on purpose: a plan with ten
 * warnings reads as noise, so each rule only speaks when the numbers are clear.
 */
export function insights(steps: PlanStep[]): Insight[] {
  const out: Insight[] = [];
  const hottest = [...steps].sort((a, b) => b.ms - a.ms)[0];
  if (hottest && hottest.share >= 0.35 && steps.length > 1) {
    out.push({
      tone: 'info',
      stepId: hottest.id,
      title: `${stepName(hottest)} takes ${Math.round(hottest.share * 100)}% of the time`,
      why: 'If this query is slow, this is the step to change first.',
    });
  }
  for (const s of steps) {
    if (s.operator === 'CROSS_PRODUCT' || s.operator === 'NESTED_LOOP_JOIN' || s.operator === 'BLOCKWISE_NL_JOIN') {
      out.push({
        tone: 'warn',
        stepId: s.id,
        title: `${s.label}: every row is compared with every row`,
        why: 'The join has no equality condition the engine can hash on, so its cost grows with the product of both inputs. Check that each table is joined on a key.',
      });
    }
    if (s.estimate !== undefined && s.estimate > 0 && s.rows > 1000) {
      const ratio = s.rows / s.estimate;
      if (ratio >= 10 || ratio <= 0.1) {
        out.push({
          tone: 'info',
          stepId: s.id,
          title: `${stepName(s)} produced ${n(s.rows)} rows; the engine expected about ${n(s.estimate)}`,
          why: 'An estimate this far off can lead to a poor join order or memory plan. On a real warehouse, refreshing table statistics usually fixes it.',
        });
      }
    }
    if (/SCAN|READ/.test(s.operator) && s.rowsScanned >= 10_000 && s.rows > 0 && s.rows / s.rowsScanned < 0.01) {
      out.push({
        tone: 'info',
        stepId: s.id,
        title: `${stepName(s)} reads ${n(s.rowsScanned)} rows to keep ${n(s.rows)}`,
        why: 'Most of the data is read and thrown away. On a partitioned or indexed table, a filter on the partition or index column would avoid reading it.',
      });
    }
  }
  return out;
}

/**
 * True when the text is exactly one statement that only reads.
 *
 * Profiling executes the statement, so this is a safety check, not a nicety: a
 * second statement after a semicolon would run too, and an UPDATE would really
 * update. Comments are set aside first, so a query that opens with one still counts.
 */
export function isExplainable(sql: string, dialect: Dialect): boolean {
  const statements = splitStatements(sql, dialect).filter((s) => s.trim() !== '');
  return statements.length === 1 && isReadOnlyQuery(statements[0]!);
}

/** The statement that produces the profile. Only for statements that only read. */
export function explainSql(sql: string): string {
  return `EXPLAIN (ANALYZE, FORMAT JSON) ${sql.trim().replace(/;\s*$/, '')}`;
}
