import type { Dialect } from './dialects';
import { scan, splitStatements } from './tokenize';

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
 * Findings are deliberately few. A review that flags twenty things on every query
 * gets scrolled past.
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
  /** True when the statement shows the pattern, tested against code positions only. */
  test?: (code: string, dialect: Dialect) => boolean;
  /**
   * Tested against the whole original text instead, for the rare rule that has to
   * look inside a string literal. Everything else deliberately cannot see string
   * contents, which is what stops `note = 'SELECT * FROM x'` raising a finding.
   */
  testWhole?: (sql: string, dialect: Dialect) => boolean;
}

/**
 * A string literal sitting immediately after LIKE, whose pattern opens with %.
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
    if (!/\bLIKE\s*$/i.test(previous.text)) return false;
    // The opening delimiter varies by dialect (', ", `, and prefixes like N or E),
    // so strip whatever the scanner captured and look at the pattern's first character.
    return segment.text.replace(/^[A-Za-z]*['"`]/, '').startsWith('%');
  });
}

const has = (re: RegExp) => (code: string) => re.test(code);

const RULES: Rule[] = [
  {
    id: 'select-star',
    severity: 'high',
    title: 'SELECT * reads every column',
    why: 'Columnar stores like Snowflake, BigQuery, Redshift and Athena bill by bytes scanned, and reading a column you discard costs exactly as much as reading one you use. On a wide table this is usually the single largest avoidable cost in a query.',
    fix: 'Name the columns you actually need. If you are exploring, add a LIMIT so the scan stays small.',
    test: has(/\bSELECT\s+(?:DISTINCT\s+|ALL\s+|TOP\s*\(?\s*\d+\s*\)?\s+)*\*/i),
  },
  {
    id: 'leading-wildcard-like',
    severity: 'medium',
    title: "LIKE pattern starts with a wildcard",
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
    test: has(
      /\bWHERE\b[\s\S]*?\b(?:date|date_trunc|cast|upper|lower|substr|substring|year|month|day|to_char|trunc|coalesce)\s*\(\s*[A-Za-z_][\w.]*\s*[,)][\s\S]*?[=<>]/i,
    ),
  },
  {
    id: 'not-in-subquery',
    severity: 'high',
    title: 'NOT IN with a subquery',
    why: 'If the subquery returns a single NULL, NOT IN returns no rows at all — silently, with no error. It is also usually planned worse than the alternative.',
    fix: 'Use NOT EXISTS, which has the null behaviour people expect and generally plans as an anti-join.',
    test: has(/\bNOT\s+IN\s*\(\s*SELECT\b/i),
  },
  {
    id: 'comma-join',
    severity: 'medium',
    title: 'Tables joined with a comma',
    why: 'Comma joins produce a cross product unless every pair is constrained in the WHERE clause. One forgotten predicate multiplies the row count instead of raising an error.',
    fix: 'Use explicit JOIN ... ON. The join condition then sits next to the join it belongs to, and a missing one is visible.',
    test: (code) => /\bFROM\b[^()]*?,[^()]*?\bWHERE\b/i.test(code),
  },
  {
    id: 'count-distinct',
    severity: 'low',
    title: 'COUNT(DISTINCT …) over a large set',
    why: 'An exact distinct count has to hold every distinct value in memory and cannot be computed in parallel as cheaply as an approximation.',
    fix: 'Where an estimate is good enough, Snowflake and BigQuery offer APPROX_COUNT_DISTINCT(), and Trino and Athena offer approx_distinct(). Typical error is under 2%.',
    test: has(/\bCOUNT\s*\(\s*DISTINCT\b/i),
  },
  {
    id: 'order-by-no-limit',
    severity: 'medium',
    title: 'ORDER BY without a LIMIT',
    why: 'Sorting is one of the few operations that cannot stream — the engine materialises and orders the entire result before returning the first row. Without a LIMIT you pay that for rows you may never read.',
    fix: 'Add a LIMIT if you only need the top rows. If the ordering is for a downstream consumer, consider sorting there instead.',
    test: (code) => /\bORDER\s+BY\b/i.test(code) && !/\bLIMIT\b|\bFETCH\s+FIRST\b|\bTOP\b/i.test(code),
  },
  {
    id: 'select-distinct',
    severity: 'low',
    title: 'SELECT DISTINCT',
    why: 'DISTINCT is often added to hide duplicate rows produced by a join that fans out, which means the engine builds the larger result first and then removes rows from it.',
    fix: 'Check whether a join is multiplying rows. If it is, fix the join condition or aggregate deliberately rather than de-duplicating afterwards.',
    test: has(/\bSELECT\s+DISTINCT\b/i),
  },
  {
    id: 'no-filter',
    severity: 'medium',
    title: 'No WHERE clause',
    why: 'The query reads the whole table. On a partitioned table that means every partition, which on a pay-per-scan engine is the most expensive thing you can do by accident.',
    fix: 'Add a predicate on the partition column if the table has one, even a wide one — it is the difference between reading a day and reading the history.',
    test: (code) =>
      /\bSELECT\b/i.test(code) &&
      /\bFROM\b/i.test(code) &&
      !/\bWHERE\b/i.test(code) &&
      !/\binformation_schema\b/i.test(code),
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
