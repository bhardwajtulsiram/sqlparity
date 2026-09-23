import type { Dialect } from './dialects';
import { IDENTIFIER_STANDIN, scan, splitStatements } from './tokenize';

/**
 * Performance review by rule, not by model.
 *
 * Every competitor doing this sends your query to a server and asks a language model.
 * That is a reasonable product and an impossible one here — it would mean uploading
 * the schema this tool exists to keep local. So these are the patterns that are
 * genuinely knowable from the text alone: long-established anti-patterns with a
 * documented reason and a concrete fix.
 *
 * What that rules out is worth stating plainly. Without table statistics, indexes,
 * partition layout or row counts, nothing here can tell you which of two queries is
 * faster, or whether an index would help. It can only point at shapes that are
 * reliably expensive, and explain why.
 *
 * Findings are deliberately few, and each rule reads the query's structure — which
 * SELECT a clause belongs to, what is inside brackets — rather than searching the
 * flat text. A review that flags `ORDER BY` inside a window function, or `SELECT *`
 * inside `EXISTS`, gets scrolled past, and then so does the finding that mattered.
 */

export type Severity = 'high' | 'medium' | 'low';

export interface ReviewFinding {
  rule: string;
  severity: Severity;
  /** What was found, in a few words. */
  title: string;
  /** Why it costs something — the part that makes the finding actionable. */
  why: string;
  /** What to do instead. */
  fix: string;
}

interface Rule {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  fix: string;
  /**
   * True when the statement shows the pattern. It sees code only: every string is
   * `''`, every quoted name `__id__`, every comment a space.
   */
  test?: (code: string, dialect: Dialect) => boolean;
  /**
   * Tested against the whole original text instead, for the rare rule that has to
   * look inside a string literal. Everything else deliberately cannot see string
   * contents, which is what stops `note = 'SELECT * FROM x'` raising a finding.
   */
  testWhole?: (sql: string, dialect: Dialect) => boolean;
}

/* ---------------------------------------------------------------- structure */

/** `text` with everything inside brackets below the top level blanked out. */
function topLevel(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') {
      out += depth === 0 ? '(' : ' ';
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      out += depth === 0 ? ')' : ' ';
    } else {
      out += depth === 0 ? ch : ch === '\n' ? '\n' : ' ';
    }
  }
  return out;
}

/** Where the group holding `at` ends: its closing bracket, or the end of the text. */
function groupEnd(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return text.length;
}

/** Every index at which `pattern` matches in `text`. */
function indexesOf(text: string, pattern: RegExp): number[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  const found: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    found.push(m.index);
    if (m[0] === '') re.lastIndex++;
  }
  return found;
}

const CLAUSE_END =
  /\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|FETCH|OFFSET|UNION|INTERSECT|EXCEPT|MINUS|WINDOW|QUALIFY)\b/i;

/**
 * One SELECT's own blocks: its select list and its FROM clause, as top-level text of
 * its group. `from` is null when the SELECT reads no table.
 */
interface SelectBlock {
  /** Top-level text of the whole SELECT, up to a set operator or the end of its group. */
  level: string;
  list: string;
  from: string | null;
  /** The code just before the SELECT, for telling `EXISTS (SELECT *` apart. */
  before: string;
}

function selectBlocks(code: string): SelectBlock[] {
  const blocks: SelectBlock[] = [];
  for (const at of indexesOf(code, /\bSELECT\b/i)) {
    const end = groupEnd(code, at);
    let level = topLevel(code.slice(at, end));
    // A set operator ends this SELECT; the next one starts its own block.
    const setOp = /\b(?:UNION|INTERSECT|EXCEPT|MINUS)\b/i.exec(level.slice(6));
    if (setOp) level = level.slice(0, 6 + setOp.index);
    const fromAt = /\bFROM\b/i.exec(level);
    const list = level.slice(6, fromAt ? fromAt.index : level.length);
    let from: string | null = null;
    if (fromAt) {
      const rest = level.slice(fromAt.index + 4);
      const stop = CLAUSE_END.exec(rest);
      from = rest.slice(0, stop ? stop.index : rest.length);
    }
    blocks.push({ level, list, from, before: code.slice(Math.max(0, at - 40), at) });
  }
  return blocks;
}

/** Top-level comma-separated items. */
function items(text: string): string[] {
  return topLevel(text).split(',').map((s) => s.trim());
}

/* ------------------------------------------------------------ the checks */

/**
 * A string literal sitting immediately after LIKE or ILIKE, whose pattern opens
 * with %.
 *
 * This has to read the literal itself, so it works from the scanner's segments rather
 * than the code-only text every other rule sees. Requiring the preceding code segment
 * to end in LIKE is what keeps it from firing on an unrelated '%...' string elsewhere.
 */
function hasLeadingWildcardLike(sql: string, dialect: Dialect): boolean {
  const segments = scan(sql, dialect);
  return segments.some((segment, i) => {
    if (segment.kind !== 'string') return false;
    const previous = segments[i - 1];
    if (!previous || previous.kind !== 'code') return false;
    if (!/\bI?LIKE\s*$/i.test(previous.text)) return false;
    // The opening delimiter varies by dialect (', ", `, and prefixes like N or E),
    // so strip whatever the scanner captured and look at the pattern's first character.
    return segment.text.replace(/^[A-Za-z]*['"`]/, '').startsWith('%');
  });
}

/** `SELECT *` or `SELECT t.*` — anywhere but inside EXISTS, where no column is read. */
function selectsStar(code: string): boolean {
  return selectBlocks(code).some((block) => {
    if (/\bEXISTS\s*\(\s*$/i.test(block.before)) return false;
    const list = block.list.replace(/^\s*(?:(?:DISTINCT|ALL)\s+|TOP\s*(?:\(\s*\d*\s*\)|\d+)\s*(?:PERCENT\s+)?)*/i, '');
    return items(list).some((item) => /^(?:[\w$]+\s*\.\s*)*\*$/.test(item));
  });
}

/** Words that can appear in a constant expression without naming a column. */
const CONSTANT_WORDS = new Set(
  `DATE TIMESTAMP TIME INTERVAL CURRENT_DATE CURRENT_TIMESTAMP CURRENT_TIME LOCALTIMESTAMP
  LOCALTIME NULL TRUE FALSE AND OR NOT DAY DAYS MONTH MONTHS YEAR YEARS HOUR HOURS MINUTE MINUTES
  SECOND SECONDS WEEK WEEKS QUARTER AS INT INTEGER BIGINT SMALLINT VARCHAR CHAR DECIMAL NUMERIC
  DOUBLE REAL FLOAT DATETIME STRING TEXT BOOLEAN ZONE AT WITH UTC FROM TO UNIT SYSDATE`.split(/\s+/),
);

/** Functions whose use on a column stops the engine using that column to prune or seek. */
const WRAPPING_FUNCTIONS = new Set(
  `DATE DATE_TRUNC DATETRUNC CAST TRY_CAST CONVERT UPPER LOWER TRIM LTRIM RTRIM SUBSTR SUBSTRING
  LEFT RIGHT YEAR MONTH DAY HOUR EXTRACT TO_CHAR TO_DATE DATE_FORMAT FORMAT_DATETIME TRUNC
  COALESCE NVL IFNULL ISNULL CONCAT ABS ROUND FLOOR CEIL DATE_ADD DATEADD FROM_UNIXTIME`.split(/\s+/),
);

/** True when an expression mentions no column — a literal, a parameter, a date function of literals. */
function isConstant(expression: string): boolean {
  const stripped = expression
    .replace(/''/g, ' ')
    .replace(/[:@]\w+|\$\d+|\?|\{\{[^}]*\}\}|\$\{[^}]*\}/g, ' ')
    .replace(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, ' ');
  for (const m of stripped.matchAll(/[A-Za-z_][\w$]*(?:\s*\.\s*[A-Za-z_][\w$]*)*(\s*\()?/g)) {
    if (m[1]) continue; // a function name
    if (!CONSTANT_WORDS.has(m[0].toUpperCase())) return false;
  }
  return true;
}

/** True when an expression is, as a whole, one of the wrapping functions applied to a column. */
function isWrappedColumn(expression: string): boolean {
  const call = /^\s*([A-Za-z_]+)\s*\(([\s\S]*)\)\s*$/.exec(expression);
  if (!call || !WRAPPING_FUNCTIONS.has(call[1]!.toUpperCase())) return false;
  // The call must be one call, not `f(a) + g(b)`.
  if (groupEnd(expression, expression.indexOf('(') + 1) !== expression.lastIndexOf(')')) return false;
  return !isConstant(call[2]!);
}

/** Split a WHERE clause into its predicates, keeping `BETWEEN x AND y` whole. */
function predicates(clause: string): string[] {
  const level = topLevel(clause);
  const out: string[] = [];
  let start = 0;
  let between = false;
  for (const m of level.matchAll(/\b(BETWEEN|AND|OR)\b/gi)) {
    const word = m[1]!.toUpperCase();
    if (word === 'BETWEEN') {
      between = true;
      continue;
    }
    if (word === 'AND' && between) {
      between = false;
      continue;
    }
    out.push(clause.slice(start, m.index!));
    start = m.index! + m[0].length;
  }
  out.push(clause.slice(start));
  return out
    .map((p) => p.trim().replace(/^NOT\s+/i, ''))
    .filter(Boolean)
    .flatMap((p) =>
      // `(date(x) = '…' OR y = 1)` holds predicates of its own.
      p.startsWith('(') && groupEnd(p, 1) === p.length - 1 ? predicates(p.slice(1, -1)) : [p],
    );
}

const COMPARISON = /(<=|>=|<>|!=|=|<|>|\bNOT\s+IN\b|\bIN\b|\bNOT\s+BETWEEN\b|\bBETWEEN\b|\bNOT\s+I?LIKE\b|\bI?LIKE\b)/i;

/**
 * A filter of the shape `f(column) = constant`.
 *
 * Only a comparison against a constant counts. `coalesce(a.x, '~') <> coalesce(b.x,
 * '~')` compares two tables' columns with each other, which no index or partition
 * could have answered in the first place, so wrapping them costs nothing.
 */
function filtersThroughFunction(code: string): boolean {
  for (const at of indexesOf(code, /\bWHERE\b/i)) {
    const end = groupEnd(code, at);
    let clause = code.slice(at + 5, end);
    const stop = CLAUSE_END.exec(topLevel(clause));
    if (stop) clause = clause.slice(0, stop.index);

    for (const predicate of predicates(clause)) {
      const operator = COMPARISON.exec(topLevel(predicate));
      if (!operator) continue;
      const left = predicate.slice(0, operator.index);
      const right = predicate.slice(operator.index + operator[0].length);
      if ((isWrappedColumn(left) && isConstant(right)) || (isWrappedColumn(right) && isConstant(left))) {
        return true;
      }
    }
  }
  return false;
}

/** Things after a comma in FROM that are not a second table: array expansion and table functions. */
const NOT_A_JOIN = /^(?:LATERAL\b|UNNEST\s*\(|TABLE\s*\(|FLATTEN\s*\(|[\w.]+\s*\()/i;

/** Two tables in one FROM, separated by a comma. */
function commaJoins(code: string): boolean {
  return selectBlocks(code).some((block) => {
    if (block.from === null) return false;
    const [, ...rest] = items(block.from);
    return rest.some((item) => item !== '' && !NOT_A_JOIN.test(item));
  });
}

/** An ORDER BY for the statement itself — not one inside OVER () or an aggregate — with no cap. */
function sortsWithoutLimit(code: string): boolean {
  const level = topLevel(code);
  return /\bORDER\s+BY\b/i.test(level) && !/\bLIMIT\b|\bFETCH\s+(?:FIRST|NEXT)\b|\bSELECT\s+(?:DISTINCT\s+)?TOP\b/i.test(level);
}

/** CTE names declared in a statement, lower-cased. */
function cteNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][\w$]*)\s*(?:\([^)]*\)\s*)?AS\s*\(/gi)) {
    names.add(m[1]!.toLowerCase());
  }
  return names;
}

/** The tables a FROM clause reads, lower-cased: CTEs, subqueries and table functions excluded. */
function tablesRead(from: string, ctes: Set<string>): string[] {
  const refs: string[] = [];
  const parts = topLevel(from).split(/,|\b(?:(?:LEFT|RIGHT|FULL|INNER|CROSS|NATURAL)\s+)*(?:OUTER\s+)?JOIN\b/i);
  for (const part of parts) {
    const ref = /^\s*([A-Za-z_][\w$]*(?:\s*\.\s*[A-Za-z_][\w$]*)*)(\s*\()?/.exec(part);
    if (!ref || ref[2]) continue; // a subquery, or a table function
    const name = ref[1]!.replace(/\s+/g, '').toLowerCase();
    if (name === IDENTIFIER_STANDIN || ctes.has(name) || name === 'dual' || name.startsWith('information_schema')) continue;
    if (/^(?:lateral|unnest)$/.test(name)) continue;
    refs.push(name);
  }
  return refs;
}

/**
 * A SELECT reading a real table with no WHERE of its own.
 *
 * Checked per SELECT, not per statement: a WHERE inside a CTE says nothing about the
 * outer query that joins it to an unfiltered fact table.
 */
function readsWithoutFilter(code: string): boolean {
  const ctes = cteNames(code);
  return selectBlocks(code).some((block) => {
    if (block.from === null) return false;
    if (/\bWHERE\b/i.test(block.level)) return false;
    return tablesRead(block.from, ctes).length > 0;
  });
}

const RULES: Rule[] = [
  {
    id: 'select-star',
    severity: 'high',
    title: 'SELECT * reads every column',
    why: 'Columnar stores like Snowflake, BigQuery, Redshift and Athena bill by bytes scanned, and reading a column you discard costs exactly as much as reading one you use. On a wide table this is usually the single largest avoidable cost in a query.',
    fix: 'Name the columns you actually need. If you are exploring, add a LIMIT so the scan stays small.',
    test: selectsStar,
  },
  {
    id: 'leading-wildcard-like',
    severity: 'medium',
    title: 'LIKE pattern starts with a wildcard',
    why: "A pattern beginning with % cannot use an index or a column's min/max statistics, so the engine has to read and test every row.",
    fix: 'Anchor the pattern if you can (LIKE \'abc%\'). For genuine substring search, a full-text or search index is the right tool.',
    testWhole: hasLeadingWildcardLike,
  },
  {
    id: 'function-on-filtered-column',
    severity: 'high',
    title: 'A function wraps the column being filtered',
    why: 'Once a column is inside a function the engine can no longer match it against an index or prune partitions by it, so a filter that looks narrow reads everything. This is the usual reason a date filter still scans the whole table.',
    fix: 'Rewrite the predicate so the bare column is on one side — compare against a computed range instead of transforming the column.',
    test: filtersThroughFunction,
  },
  {
    id: 'not-in-subquery',
    severity: 'high',
    title: 'NOT IN with a subquery',
    why: 'If the subquery returns a single NULL, NOT IN returns no rows at all — silently, with no error. It is also usually planned worse than the alternative.',
    fix: 'Use NOT EXISTS, which has the null behaviour people expect and generally plans as an anti-join.',
    test: (code) => /\bNOT\s+IN\s*\(\s*SELECT\b/i.test(code),
  },
  {
    id: 'comma-join',
    severity: 'medium',
    title: 'Tables joined with a comma',
    why: 'Comma joins produce a cross product unless every pair is constrained in the WHERE clause. One forgotten predicate multiplies the row count instead of raising an error.',
    fix: 'Use explicit JOIN ... ON. The join condition then sits next to the join it belongs to, and a missing one is visible.',
    test: commaJoins,
  },
  {
    id: 'count-distinct',
    severity: 'low',
    title: 'COUNT(DISTINCT …) over a large set',
    why: 'An exact distinct count has to hold every distinct value in memory and cannot be computed in parallel as cheaply as an approximation.',
    fix: 'Where an estimate is good enough, Snowflake and BigQuery offer APPROX_COUNT_DISTINCT(), and Trino and Athena offer approx_distinct(). Typical error is under 2%.',
    test: (code) => /\bCOUNT\s*\(\s*DISTINCT\b/i.test(code),
  },
  {
    id: 'order-by-no-limit',
    severity: 'medium',
    title: 'ORDER BY without a LIMIT',
    why: 'Sorting is one of the few operations that cannot stream — the engine materialises and orders the entire result before returning the first row. Without a LIMIT you pay that for rows you may never read.',
    fix: 'Add a LIMIT if you only need the top rows. If the ordering is for a downstream consumer, consider sorting there instead.',
    test: sortsWithoutLimit,
  },
  {
    id: 'select-distinct',
    severity: 'low',
    title: 'SELECT DISTINCT',
    why: 'DISTINCT is often added to hide duplicate rows produced by a join that fans out, which means the engine builds the larger result first and then removes rows from it.',
    fix: 'Check whether a join is multiplying rows. If it is, fix the join condition or aggregate deliberately rather than de-duplicating afterwards.',
    test: (code) => /\bSELECT\s+DISTINCT\b/i.test(code),
  },
  {
    id: 'no-filter',
    severity: 'medium',
    title: 'A table is read with no WHERE clause',
    why: 'That part of the query reads the whole table. On a partitioned table that means every partition, which on a pay-per-scan engine is the most expensive thing you can do by accident — and a filter elsewhere in the query, in a CTE or a subquery, does not narrow it.',
    fix: 'Add a predicate on the partition column if the table has one, even a wide one — it is the difference between reading a day and reading the history.',
    test: readsWithoutFilter,
  },
];

export function reviewSql(sql: string, dialect: Dialect): ReviewFinding[] {
  if (sql.trim() === '') return [];

  const findings: ReviewFinding[] = [];
  const statements = splitStatements(sql, dialect);

  for (const rule of RULES) {
    if (rule.testWhole) {
      if (!rule.testWhole(sql, dialect)) continue;
    } else {
      // One finding per rule for the whole input, however many statements trip it:
      // the same advice repeated is noise, and the fix is the same either way.
      if (!statements.some((statement) => rule.test!(statement, dialect))) continue;
    }
    findings.push({
      rule: rule.id,
      severity: rule.severity,
      title: rule.title,
      why: rule.why,
      fix: rule.fix,
    });
  }

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Rule count, so the page can say what it checks without listing all of them. */
export const RULE_COUNT = RULES.length;
