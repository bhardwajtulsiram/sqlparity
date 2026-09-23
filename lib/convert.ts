import type { Dialect } from './dialects';
import { escapeStringBody } from './escape';
import { isInLiteral, scan, type Segment } from './tokenize';

/**
 * Mechanical dialect translation.
 *
 * The competing tools do this by asking a language model, which works well and
 * requires sending them your query. That is the one thing this tool will not do, so
 * what is here is a rewriter: quoting rules, string escaping, row limits, and a table
 * of functions that differ only in name.
 *
 * The interesting design decision is what it refuses to touch. A rename is only safe
 * when the two functions take the same arguments in the same order and return the
 * same answer. CHARINDEX and STRPOS look interchangeable and have their arguments
 * reversed; DATEDIFF exists in several dialects with different meanings; `7 / 2` is 3
 * in one engine and 3.5 in another. Rewriting those produces SQL that runs and returns
 * wrong answers — the worst possible outcome, and one you would not catch in review.
 * So they are reported as unconverted instead, with the reason.
 *
 * Everything it changed and everything it could not is returned alongside the SQL.
 * A converter you have to trust blindly is not useful for data you care about.
 */

export type ChangeKind = 'quoting' | 'escaping' | 'function' | 'type' | 'rows' | 'clause';

export interface Change {
  kind: ChangeKind;
  /** What was found. */
  from: string;
  /** What it became. */
  to: string;
  /** How many places changed. */
  count: number;
}

export interface Unconverted {
  /** The construct, as it appears in the query. */
  feature: string;
  /** Why a mechanical rewrite would be wrong, and what to do by hand. */
  why: string;
}

export interface ConvertResult {
  sql: string;
  changes: Change[];
  unconverted: Unconverted[];
}

/* ------------------------------------------------------------------ structure */

/** 1 where the character is code, 0 inside a string, comment or quoted name. */
function codeMap(sql: string, segments: Segment[]): Uint8Array {
  const map = new Uint8Array(sql.length);
  for (const segment of segments) if (segment.kind === 'code') map.fill(1, segment.start, segment.end);
  return map;
}

/**
 * The parenthesised group — or the whole statement — that position `at` belongs to.
 *
 * A row cap belongs to the SELECT at its own nesting level, not to whichever SELECT
 * comes first in the text. Knowing the group is what lets an inner `LIMIT 5` stay with
 * its subquery rather than being mistaken for the outer query's.
 */
function groupAt(sql: string, code: Uint8Array, at: number): { start: number; end: number; paren: boolean } {
  let depth = 0;
  let start = 0;
  let paren = false;
  for (let j = at - 1; j >= 0; j--) {
    if (!code[j]) continue;
    const ch = sql[j];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        start = j + 1;
        paren = true;
        break;
      }
      depth--;
    } else if (ch === ';' && depth === 0) {
      start = j + 1;
      break;
    }
  }
  depth = 0;
  let end = sql.length;
  for (let j = at; j < sql.length; j++) {
    if (!code[j]) continue;
    const ch = sql[j];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0 && paren) {
        end = j;
        break;
      }
      if (depth > 0) depth--;
    } else if (ch === ';' && depth === 0 && !paren) {
      end = j;
      break;
    }
  }
  return { start, end, paren };
}

/** The text of [from, to) with nested brackets and non-code blanked, so a regex sees only this level. */
function levelText(sql: string, code: Uint8Array, from: number, to: number): string {
  let out = '';
  let depth = 0;
  for (let i = from; i < to; i++) {
    const ch = sql[i]!;
    const blank = ch === '\n' ? '\n' : ' ';
    if (!code[i]) {
      out += blank;
      continue;
    }
    if (ch === '(') {
      out += depth === 0 ? '(' : ' ';
      depth++;
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth--;
      out += depth === 0 ? ')' : ' ';
      continue;
    }
    out += depth > 0 ? blank : ch;
  }
  return out;
}

/** Index of the `)` closing the `(` at `open`, looking at code only. */
function closingParen(sql: string, code: Uint8Array, open: number): number {
  let depth = 0;
  for (let j = open; j < sql.length; j++) {
    if (!code[j]) continue;
    if (sql[j] === '(') depth++;
    else if (sql[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

/** Index of the unmatched `(` enclosing `at`, or -1. */
function openParenBefore(sql: string, code: Uint8Array, at: number): number {
  let depth = 0;
  for (let j = at - 1; j >= 0; j--) {
    if (!code[j]) continue;
    if (sql[j] === ')') depth++;
    else if (sql[j] === '(') {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

interface Edit {
  at: number;
  remove: number;
  insert: string;
}

function applyEdits(sql: string, edits: Edit[]): string {
  let out = sql;
  for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.insert + out.slice(edit.at + edit.remove);
  }
  return out;
}

/* ------------------------------------------------------------------ functions */

/**
 * Functions that differ only in spelling.
 *
 * A family may only live here if every listed spelling takes the same arguments in
 * the same order and means the same thing. `null` means the dialect has no same-shape
 * equivalent, which makes the family unconvertible into it rather than a guess.
 */
interface FunctionFamily {
  /** The spelling each dialect wants, by dialect id. */
  names: Record<string, string | null>;
  /** Spelling for dialects not listed above. */
  fallback: string | null;
  /** Extra spellings recognised in the input but never emitted. */
  readAlso?: string[];
  /** Set when the source spelling means something else in other dialects. */
  onlyFrom?: string[];
  why?: string;
  /** Leave a call alone when its arguments match this — a different syntax, not a rename. */
  skipArgs?: RegExp;
}

/** Engines that accept `SUBSTRING(x FROM 2 FOR 3)`. */
const SUBSTRING_FROM = ['postgresql', 'trino', 'mysql', 'mariadb', 'redshift', 'duckdb', 'db2', 'sql'];

const FUNCTIONS: FunctionFamily[] = [
  {
    names: {
      postgresql: 'SUBSTRING',
      transactsql: 'SUBSTRING',
      redshift: 'SUBSTRING',
      db2: 'SUBSTRING',
      clickhouse: 'SUBSTRING',
    },
    fallback: 'SUBSTR',
    // SUBSTRING(x FROM 2 FOR 3) is keyword syntax that SUBSTR does not have.
    skipArgs: /\bFROM\b/i,
  },
  {
    // Each of these is a two-argument null default, and COALESCE is a superset of all
    // of them that every dialect here supports.
    names: {},
    fallback: 'COALESCE',
    readAlso: ['NVL', 'IFNULL'],
  },
  {
    // MySQL's one-argument ISNULL() is a different function entirely — it returns a
    // boolean — so ISNULL is only read as a null default when it came from T-SQL.
    names: {},
    fallback: 'COALESCE',
    readAlso: ['ISNULL'],
    onlyFrom: ['transactsql'],
  },
  {
    names: { trino: 'APPROX_DISTINCT' },
    fallback: null,
    readAlso: ['APPROX_COUNT_DISTINCT'],
    why: 'The approximate-distinct functions differ in name and in their precision arguments. Check the target dialect for its own spelling.',
  },
];

/** The current-timestamp family, which is not always written as a function call. */
const NOW_SPELLING: Record<string, string> = {
  transactsql: 'GETDATE()',
  plsql: 'SYSDATE',
  mysql: 'NOW()',
  mariadb: 'NOW()',
  clickhouse: 'now()',
};
const NOW_DEFAULT = 'CURRENT_TIMESTAMP';
const NOW_PATTERN =
  /\b(?:GETDATE\s*\(\s*\)|NOW\s*\(\s*\)|SYSDATE\s*\(\s*\)|SYSDATE\b|CURRENT_TIMESTAMP(?:\s*\(\s*\))?)/gi;

/** Dialects whose LENGTH counts characters (MySQL's counts bytes; T-SQL spells it LEN). */
const BYTE_LENGTH = ['mysql', 'mariadb'];

/* ---------------------------------------------------------------------- types */

/**
 * Type names used in CAST. Only families whose members mean the same thing are here;
 * anything differing in precision or range is left alone deliberately.
 */
interface TypeFamily {
  /** Every spelling that identifies this family. */
  members: string[];
  names: Record<string, string>;
  fallback: string;
  /** How the length or precision in brackets carries over to the target spelling. */
  params?: (target: Dialect, params: string | undefined) => { name?: string; params: string };
}

/** A length that is a plain number, as opposed to MAX or nothing. */
const numericLength = (params: string | undefined) => (params && /^\d+$/.test(params.trim()) ? params.trim() : undefined);

const TYPE_FAMILIES: TypeFamily[] = [
  {
    members: ['VARCHAR', 'STRING', 'TEXT', 'NVARCHAR', 'VARCHAR2'],
    names: {
      bigquery: 'STRING',
      hive: 'STRING',
      spark: 'STRING',
      sqlite: 'TEXT',
      clickhouse: 'String',
      transactsql: 'NVARCHAR',
      plsql: 'VARCHAR2',
    },
    fallback: 'VARCHAR',
    params: (target, params) => {
      const length = numericLength(params);
      switch (target.id) {
        // Hive and Spark accept VARCHAR(n); only an unbounded string is STRING.
        case 'hive':
        case 'spark':
          return length ? { name: 'VARCHAR', params: `(${length})` } : { params: '' };
        case 'bigquery':
          return { params: length ? `(${length})` : '' };
        case 'sqlite':
        case 'clickhouse':
          return { params: '' };
        // A bare VARCHAR in a SQL Server CAST is 30 characters, silently truncating
        // anything longer. MAX is what an unbounded string means there.
        case 'transactsql':
          return { params: `(${length ?? 'MAX'})` };
        // Oracle has no unbounded VARCHAR2.
        case 'plsql':
          return { params: `(${length ?? '4000'})` };
        default:
          return { params: length ? `(${length})` : '' };
      }
    },
  },
  {
    members: ['INT', 'INTEGER', 'INT64'],
    names: { bigquery: 'INT64', plsql: 'NUMBER', clickhouse: 'Int32' },
    fallback: 'INTEGER',
  },
  {
    members: ['BIGINT'],
    names: { bigquery: 'INT64', plsql: 'NUMBER', clickhouse: 'Int64' },
    fallback: 'BIGINT',
  },
  {
    members: ['BOOLEAN', 'BOOL', 'BIT'],
    names: { bigquery: 'BOOL', transactsql: 'BIT', clickhouse: 'Bool' },
    fallback: 'BOOLEAN',
  },
  {
    members: ['DOUBLE', 'FLOAT64', 'DOUBLE PRECISION'],
    names: {
      bigquery: 'FLOAT64',
      postgresql: 'DOUBLE PRECISION',
      redshift: 'DOUBLE PRECISION',
      transactsql: 'FLOAT',
      sqlite: 'REAL',
      clickhouse: 'Float64',
    },
    fallback: 'DOUBLE',
  },
];

/* --------------------------------------------------------------------- limits */

type RowLimitStyle = 'limit' | 'top' | 'fetch';

/** How a dialect caps rows. Anything not listed uses LIMIT. */
const ROW_LIMIT_STYLE: Record<string, RowLimitStyle> = {
  transactsql: 'top',
  plsql: 'fetch',
  db2: 'fetch',
  sql: 'fetch',
};

const rowLimitStyle = (d: Dialect): RowLimitStyle => ROW_LIMIT_STYLE[d.id] ?? 'limit';

const STYLE_LABEL: Record<RowLimitStyle, string> = {
  limit: 'LIMIT',
  top: 'TOP',
  fetch: 'FETCH FIRST',
};

/* ------------------------------------------------------- untranslatable things */

/** Engines where `7 / 2` is 3 when both sides are integers. Elsewhere it is 3.5. */
const INTEGER_DIVISION = new Set(['trino', 'postgresql', 'redshift', 'sqlite', 'transactsql', 'db2']);
/** Where an array's first element is. BigQuery's bare `arr[n]` is an offset. */
const ARRAY_BASE: Record<string, number> = {
  trino: 1,
  postgresql: 1,
  duckdb: 1,
  clickhouse: 1,
  snowflake: 0,
  hive: 0,
  spark: 0,
  bigquery: 0,
};

/**
 * Constructs that are detected but never rewritten. Each is here because the obvious
 * mechanical translation is wrong often enough to be dangerous.
 */
interface Hazard {
  pattern: RegExp;
  feature: string;
  why: string | ((from: Dialect, to: Dialect) => string);
  /** Targets that understand it as written, where there is nothing to report. */
  safeIn?: string[];
  /** Report only when this holds — for hazards that depend on both dialects. */
  applies?: (from: Dialect, to: Dialect) => boolean;
  /** Name the matched spellings in the feature, when the pattern covers several. */
  listMatches?: boolean;
}

const HAZARDS: Hazard[] = [
  {
    pattern: /\bCHARINDEX\s*\(/i,
    feature: 'CHARINDEX',
    why: 'Its arguments are the reverse of STRPOS and INSTR — CHARINDEX takes the substring first. Swap the two arguments when you rewrite it.',
    safeIn: ['transactsql', 'snowflake'],
  },
  {
    pattern: /\bDATEDIFF\s*\(/i,
    feature: 'DATEDIFF',
    why: 'DATEDIFF exists in several dialects with different argument orders and different units — T-SQL counts calendar boundaries crossed, MySQL returns whole days. There is no safe rename.',
  },
  {
    pattern:
      /\b(?:DATE_ADD|DATEADD|DATE_SUB|ADDDATE|SUBDATE|DATE_TRUNC|DATETRUNC|DATE_FORMAT|FORMAT_DATE|FORMAT_TIMESTAMP|FORMAT_DATETIME|TO_CHAR|STRFTIME|DATE_PART|DATEPART|DATENAME|TIMESTAMPADD|TIMESTAMPDIFF|DATE_DIFF|TIMESTAMP_DIFF|DATETIME_DIFF|TO_DATE|TO_TIMESTAMP|STR_TO_DATE|DATE_PARSE|PARSE_DATE|PARSE_TIMESTAMP|PARSE_DATETIME|FROM_UNIXTIME|UNIX_TIMESTAMP|TO_UNIXTIME|LAST_DAY|MONTHS_BETWEEN|ADD_MONTHS)(?=\s*\()/gi,
    feature: 'Date functions',
    listMatches: true,
    why: "Date arithmetic, truncation and formatting differ between engines in name, argument order and format codes: Trino writes date_add('day', 1, d), Hive date_add(d, 1), BigQuery DATE_ADD(d, INTERVAL 1 DAY), and '%Y-%m-%d' in one is 'yyyy-MM-dd' in another. Rewrite each against the target's documentation.",
  },
  {
    pattern: /\b(?:GROUP_CONCAT|STRING_AGG|LISTAGG)\s*\(/i,
    feature: 'String aggregation',
    why: 'GROUP_CONCAT, STRING_AGG and LISTAGG express the separator and the ordering differently enough that the arguments have to be rebuilt, not renamed.',
  },
  {
    pattern: /\|\|/,
    feature: '|| concatenation',
    applies: (from, to) =>
      ['mysql', 'mariadb', 'transactsql'].includes(to.id) || ['mysql', 'mariadb'].includes(from.id),
    why: (from, to) =>
      ['mysql', 'mariadb'].includes(from.id)
        ? `In ${from.label}, || means OR unless PIPES_AS_CONCAT is set, so this query compares truth values; in ${to.label} it joins text. Decide which was meant — for OR, write OR.`
        : to.id === 'transactsql'
          ? 'SQL Server before 2025 has no || operator. Rewrite a || b as CONCAT(a, b).'
          : `In ${to.label}, || means OR unless PIPES_AS_CONCAT is set, so a || b returns 0 or 1 instead of the joined text — no error. Rewrite it as CONCAT(a, b).`,
  },
  {
    pattern: /(?<![/*])\/(?![/*])/,
    feature: 'Division',
    applies: (from, to) => INTEGER_DIVISION.has(from.id) !== INTEGER_DIVISION.has(to.id),
    why: (from, to) => {
      const whole = (d: Dialect) => (INTEGER_DIVISION.has(d.id) ? '3' : '3.5');
      return `When both sides are whole numbers, 7 / 2 is ${whole(from)} in ${from.label} and ${whole(to)} in ${to.label}, so the same query returns different numbers. Cast one side to DECIMAL or DOUBLE — or, for whole-number division in ${to.label}, use its integer-division function — so the result is what you meant in both.`;
    },
  },
  {
    pattern: /(?<!\bARRAY\s*)(?<=[\w)\]"`])\s*\[/i,
    feature: 'Array subscript',
    applies: (from, to) =>
      ARRAY_BASE[from.id] !== undefined &&
      ARRAY_BASE[to.id] !== undefined &&
      ARRAY_BASE[from.id] !== ARRAY_BASE[to.id],
    why: (from, to) =>
      `${from.label} counts array positions from ${ARRAY_BASE[from.id]}, ${to.label} from ${ARRAY_BASE[to.id]}: the same arr[1] is the first element in one and the second in the other, with no error.${
        to.id === 'bigquery' ? ' In BigQuery, write arr[ORDINAL(n)] to count from 1.' : ' Adjust every index by one.'
      }`,
  },
  {
    pattern: /\bILIKE\b/i,
    feature: 'ILIKE',
    why: "Only some engines have case-insensitive ILIKE. Write lower(x) LIKE lower('pattern') instead, which every engine reads the same way.",
    safeIn: ['postgresql', 'redshift', 'snowflake', 'duckdb', 'spark', 'clickhouse'],
  },
  {
    pattern: /\bIF\s*\(/i,
    feature: 'IF()',
    why: 'Rewrite IF(condition, a, b) as CASE WHEN condition THEN a ELSE b END, which every engine understands.',
    safeIn: ['mysql', 'mariadb', 'hive', 'spark', 'bigquery', 'clickhouse', 'trino', 'duckdb'],
  },
  {
    pattern: /\bIIF\s*\(/i,
    feature: 'IIF()',
    why: 'Rewrite IIF(condition, a, b) as CASE WHEN condition THEN a ELSE b END.',
    safeIn: ['transactsql', 'sqlite'],
  },
  {
    pattern: /\bIFF\s*\(/i,
    feature: 'IFF()',
    why: "IFF is Snowflake's. Rewrite IFF(condition, a, b) as CASE WHEN condition THEN a ELSE b END.",
    safeIn: ['snowflake'],
  },
  {
    pattern: /\bIS\s+(?:NOT\s+)?DISTINCT\s+FROM\b/i,
    feature: 'IS DISTINCT FROM',
    why: 'MySQL and MariaDB have no IS DISTINCT FROM. The equivalent is the null-safe operator, so a IS DISTINCT FROM b becomes NOT (a <=> b) — a change to the expression around it, not a substitution.',
    safeIn: [
      'trino',
      'postgresql',
      'bigquery',
      'snowflake',
      'redshift',
      'sqlite',
      'duckdb',
      'spark',
      'db2',
      'sql',
      'hive',
      'clickhouse',
    ],
  },
  {
    pattern: /<=>/,
    feature: '<=> (null-safe equality)',
    why: 'Outside MySQL, MariaDB, Hive and Spark this operator does not exist. The equivalent is NOT (a IS DISTINCT FROM b), which means rewriting the expression around it.',
    safeIn: ['mysql', 'mariadb', 'hive', 'spark'],
  },
  {
    pattern: /\bQUALIFY\b/i,
    feature: 'QUALIFY',
    why: 'Only Snowflake, BigQuery and DuckDB have QUALIFY among these dialects. Elsewhere the window function moves into a subquery and the filter becomes an outer WHERE.',
    safeIn: ['snowflake', 'bigquery', 'duckdb'],
  },
  {
    pattern: /\bCONNECT\s+BY\b/i,
    feature: 'CONNECT BY',
    why: "Oracle's hierarchical query syntax has no direct equivalent. It has to be rewritten as a recursive common table expression.",
    safeIn: ['plsql'],
  },
  {
    pattern: /\bDECODE\s*\(/i,
    feature: 'DECODE',
    why: 'Oracle DECODE treats two nulls as equal, which the CASE expression it is usually replaced with does not. Rewrite it as CASE and check the null branch.',
    safeIn: ['plsql', 'redshift'],
  },
  {
    pattern: /\bWITH\s*\(\s*NOLOCK\s*\)/i,
    feature: 'WITH (NOLOCK)',
    why: 'A T-SQL locking hint. Other engines set isolation at the transaction level, so the hint should simply be removed.',
    safeIn: ['transactsql'],
  },
  {
    pattern: /::/,
    feature: ':: cast',
    why: 'The :: cast shorthand belongs to the PostgreSQL family. Rewrite it as CAST(value AS type).',
    safeIn: ['postgresql', 'redshift', 'duckdb', 'clickhouse', 'snowflake'],
  },
  {
    pattern: /\bLATERAL\s+VIEW\b/i,
    feature: 'LATERAL VIEW',
    why: 'Hive and Spark expand arrays with LATERAL VIEW. Trino and Athena use CROSS JOIN UNNEST, and the column naming differs.',
    safeIn: ['hive', 'spark'],
  },
  {
    pattern: /\bROWNUM\b/i,
    feature: 'ROWNUM',
    why: 'Oracle assigns ROWNUM before ORDER BY, so it is not a row limit and cannot be turned into LIMIT without deciding what the query meant.',
    safeIn: ['plsql'],
  },
];

/* ------------------------------------------------------------------- machinery */

/** Make a global copy of a pattern, so exec can walk it without mutating the original. */
function global(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
}

/** Apply a regex across the whole query, skipping any match that starts in a literal. */
function replaceInCode(
  sql: string,
  dialect: Dialect,
  pattern: RegExp,
  replacer: (match: RegExpExecArray, code: Uint8Array) => string | null,
): { sql: string; count: number } {
  const segments = scan(sql, dialect);
  const code = codeMap(sql, segments);
  const re = global(pattern);
  let out = '';
  let last = 0;
  let count = 0;

  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (isInLiteral(segments, m.index)) continue;
    const replacement = replacer(m, code);
    if (replacement === null || replacement === m[0]) continue;
    out += sql.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
    count++;
  }

  return { sql: out + sql.slice(last), count };
}

/** Every match of a regex that starts in code. */
function codeMatches(sql: string, dialect: Dialect, pattern: RegExp): RegExpExecArray[] {
  const segments = scan(sql, dialect);
  const re = global(pattern);
  const found: RegExpExecArray[] = [];
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    if (m[0] === '') re.lastIndex++;
    if (!isInLiteral(segments, m.index)) found.push(m);
  }
  return found;
}

/** Recover the text a source string literal actually stands for. */
function decodeStringBody(body: string, from: Dialect, quote: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (from.backslashIsEscape && ch === '\\' && i + 1 < body.length) {
      const next = body[i + 1]!;
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next === '0' ? '\0' : next;
      i++;
      continue;
    }
    if (ch === quote && body[i + 1] === quote) {
      out += quote;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** How a dialect writes a string, for describing an escaping change. */
function escapingLabel(d: Dialect): string {
  return `${d.quoteEscape === 'double' ? "''" : "\\'"}, backslash ${d.backslashIsEscape ? 'escapes' : 'is literal'}`;
}

/** Re-quote identifiers and re-escape string literals for the target dialect. */
function convertLiterals(sql: string, from: Dialect, to: Dialect, changes: Change[]): string {
  const sameIdent =
    from.identifier.open === to.identifier.open && from.identifier.close === to.identifier.close;
  const sameString =
    from.quoteEscape === to.quoteEscape && from.backslashIsEscape === to.backslashIsEscape;
  if (sameIdent && sameString && !from.doubleQuoteIsString) return sql;

  let identifiers = 0;
  let strings = 0;
  let doubleQuoted = 0;

  const requote = (name: string) =>
    to.identifier.open + name.replaceAll(to.identifier.close, to.identifier.escapeClose) + to.identifier.close;

  const out = scan(sql, from)
    .map((segment) => {
      if (segment.kind === 'identifier' && !sameIdent) {
        const inner = segment.text
          .slice(1, -1)
          .replaceAll(from.identifier.escapeClose, from.identifier.close);
        identifiers++;
        // In BigQuery one pair of backticks can hold a whole path: `project.dataset.table`.
        // Elsewhere that would be a single name with dots in it.
        if (from.id === 'bigquery' && inner.includes('.')) return inner.split('.').map(requote).join('.');
        return requote(inner);
      }
      if (segment.kind === 'string') {
        const quote = segment.text[0]!;
        const isDouble = quote === '"';
        if (!isDouble && sameString) return segment.text;
        // An unterminated literal at the end of the input has no closing quote to trim.
        const closed = segment.text.length > 1 && segment.text.endsWith(quote);
        const body = closed ? segment.text.slice(1, -1) : segment.text.slice(1);
        // Always single-quoted on the way out: every target reads that as a string,
        // while "text" is a column name to most of them.
        const requoted = "'" + escapeStringBody(decodeStringBody(body, from, quote), to) + "'";
        if (isDouble) doubleQuoted++;
        else if (requoted !== segment.text) strings++;
        return requoted;
      }
      return segment.text;
    })
    .join('');

  if (identifiers > 0) {
    changes.push({
      kind: 'quoting',
      from: from.identifier.open + 'name' + from.identifier.close,
      to: to.identifier.open + 'name' + to.identifier.close,
      count: identifiers,
    });
  }
  if (doubleQuoted > 0) {
    changes.push({ kind: 'quoting', from: '"text"', to: "'text'", count: doubleQuoted });
  }
  if (strings > 0) {
    changes.push({ kind: 'escaping', from: escapingLabel(from), to: escapingLabel(to), count: strings });
  }
  return out;
}

/** The argument text of a call whose opening bracket is at `open`. */
function argumentsOf(sql: string, code: Uint8Array, open: number): { text: string; close: number } | null {
  const close = closingParen(sql, code, open);
  if (close === -1) return null;
  return { text: levelText(sql, code, open + 1, close), close };
}

/** Rename functions whose only difference between the two dialects is spelling. */
function convertFunctions(
  sql: string,
  from: Dialect,
  to: Dialect,
  changes: Change[],
  unconverted: Unconverted[],
): string {
  let out = sql;

  for (const family of FUNCTIONS) {
    if (family.onlyFrom && !family.onlyFrom.includes(from.id)) continue;

    const spellings = [
      ...new Set(
        [
          family.names[from.id] ?? family.fallback,
          ...(family.readAlso ?? []),
          ...Object.values(family.names),
        ].filter((name): name is string => name !== null),
      ),
    ];
    if (spellings.length === 0) continue;

    const target = family.names[to.id] ?? family.fallback;
    const pattern = new RegExp('\\b(' + spellings.join('|') + ')(\\s*\\()', 'gi');

    if (target === null) {
      if (family.why && codeMatches(out, to, pattern).length > 0) {
        unconverted.push({ feature: spellings[0]!, why: family.why });
      }
      continue;
    }

    // Report what was actually found. Several spellings share one family, and naming
    // the wrong one produces a change line reading COALESCE() -> COALESCE().
    const matched = new Set<string>();
    let skippedSyntax = false;
    const replaced = replaceInCode(out, to, pattern, (m, code) => {
      if (m[1]!.toUpperCase() === target.toUpperCase()) return null;
      if (family.skipArgs) {
        const args = argumentsOf(out, code, m.index + m[0].length - 1);
        if (args && family.skipArgs.test(args.text)) {
          skippedSyntax = true;
          return null;
        }
      }
      matched.add(m[1]!.toUpperCase());
      return target + m[2];
    });
    if (replaced.count > 0) {
      out = replaced.sql;
      changes.push({
        kind: 'function',
        from: [...matched].join(', ') + '()',
        to: target + '()',
        count: replaced.count,
      });
    }
    if (skippedSyntax && !SUBSTRING_FROM.includes(to.id)) {
      unconverted.push({
        feature: 'SUBSTRING … FROM … FOR',
        why: `${to.label} does not accept the keyword form. Rewrite SUBSTRING(x FROM start FOR length) as SUBSTR(x, start, length).`,
      });
    }
  }

  out = convertLength(out, from, to, changes, unconverted);

  const nowTarget = NOW_SPELLING[to.id] ?? NOW_DEFAULT;
  const bare = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const now = replaceInCode(out, to, NOW_PATTERN, (m) =>
    bare(m[0]) === bare(nowTarget) ? null : nowTarget,
  );
  if (now.count > 0) {
    out = now.sql;
    changes.push({ kind: 'function', from: 'current timestamp', to: nowTarget, count: now.count });
  }

  // `FROM dual` is Oracle's and MySQL's way of selecting nothing; elsewhere the table
  // does not exist, and a SELECT needs no FROM at all.
  if (!['plsql', 'mysql', 'mariadb'].includes(to.id)) {
    const dual = replaceInCode(out, to, /\s+FROM\s+dual\b/gi, () => '');
    if (dual.count > 0) {
      out = dual.sql;
      changes.push({ kind: 'clause', from: 'FROM dual', to: '(removed)', count: dual.count });
    }
  }

  return out;
}

/**
 * String length, which is not one function under different names.
 *
 * SQL Server's LEN ignores trailing spaces, and MySQL's LENGTH counts bytes rather
 * than characters. So LEN(x) becomes LENGTH(RTRIM(x)) — the same number — and a
 * character count moving into MySQL becomes CHAR_LENGTH.
 */
function convertLength(
  sql: string,
  from: Dialect,
  to: Dialect,
  changes: Change[],
  unconverted: Unconverted[],
): string {
  let out = sql;
  const charLength = BYTE_LENGTH.includes(to.id) ? 'CHAR_LENGTH' : 'LENGTH';

  if (from.id === 'transactsql' && to.id !== 'transactsql') {
    const edits: Edit[] = [];
    replaceInCode(out, to, /\bLEN(\s*\()/gi, (m, code) => {
      const open = m.index + m[0].length - 1;
      const close = closingParen(out, code, open);
      if (close === -1) return null;
      edits.push({ at: m.index, remove: close + 1 - m.index, insert: `${charLength}(RTRIM(${out.slice(open + 1, close)}))` });
      return null;
    });
    if (edits.length > 0) {
      out = applyEdits(out, edits);
      changes.push({ kind: 'function', from: 'LEN(x)', to: `${charLength}(RTRIM(x))`, count: edits.length });
    }
    return out;
  }

  if (to.id === 'transactsql') {
    const renamed = replaceInCode(out, to, /\b(?:LENGTH|CHAR_LENGTH|CHARACTER_LENGTH)(\s*\()/gi, (m) => `LEN${m[1]}`);
    if (renamed.count > 0) {
      out = renamed.sql;
      changes.push({ kind: 'function', from: 'LENGTH()', to: 'LEN()', count: renamed.count });
      unconverted.push({
        feature: 'LEN ignores trailing spaces',
        why: "SQL Server's LEN does not count trailing spaces, so a value ending in spaces comes out shorter than LENGTH reported. Where that matters, use LEN(x + 'x') - 1.",
      });
    }
    return out;
  }

  if (BYTE_LENGTH.includes(from.id) && !BYTE_LENGTH.includes(to.id)) {
    if (codeMatches(out, to, /\bLENGTH\s*\(/i).length > 0) {
      unconverted.push({
        feature: 'LENGTH (bytes in MySQL)',
        why: `MySQL's LENGTH counts bytes, so 'é' is 2; ${to.label}'s LENGTH counts characters. If the query meant bytes, use OCTET_LENGTH; if it meant characters, LENGTH is already right.`,
      });
    }
    const renamed = replaceInCode(out, to, /\b(?:CHAR_LENGTH|CHARACTER_LENGTH)(\s*\()/gi, (m) => `LENGTH${m[1]}`);
    if (renamed.count > 0 && ['trino', 'sqlite'].includes(to.id)) {
      out = renamed.sql;
      changes.push({ kind: 'function', from: 'CHAR_LENGTH()', to: 'LENGTH()', count: renamed.count });
    }
    return out;
  }

  if (BYTE_LENGTH.includes(to.id) && !BYTE_LENGTH.includes(from.id)) {
    const renamed = replaceInCode(out, to, /\bLENGTH(\s*\()/gi, (m) => `CHAR_LENGTH${m[1]}`);
    if (renamed.count > 0) {
      out = renamed.sql;
      changes.push({ kind: 'function', from: 'LENGTH()', to: 'CHAR_LENGTH()', count: renamed.count });
    }
  }
  return out;
}

/** True when the bracket enclosing `at` opens a CAST. */
function insideCast(sql: string, code: Uint8Array, at: number): boolean {
  const open = openParenBefore(sql, code, at);
  if (open === -1) return false;
  return /\b(?:CAST|TRY_CAST|SAFE_CAST)\s*$/i.test(sql.slice(Math.max(0, open - 12), open));
}

/** Rewrite type names inside CAST, where the two dialects spell the same type differently. */
function convertTypes(sql: string, from: Dialect, to: Dialect, changes: Change[]): string {
  let out = sql;

  for (const family of TYPE_FAMILIES) {
    const target = family.names[to.id] ?? family.fallback;
    const sourceName = family.names[from.id] ?? family.fallback;
    const spellings = [...new Set([sourceName, ...family.members])].sort((a, b) => b.length - a.length);
    // Only inside CAST(x AS t): an alias like `name AS text` is a column name.
    const pattern = new RegExp(
      '(\\bAS\\s+)(' + spellings.join('|') + ')\\b(\\s*\\(\\s*([^)]*?)\\s*\\))?',
      'gi',
    );

    const matched = new Set<string>();
    const replaced = replaceInCode(out, to, pattern, (m, code) => {
      if (!insideCast(out, code, m.index)) return null;
      const carried = family.params
        ? family.params(to, m[4])
        : { params: m[3] ?? '' };
      const name = carried.name ?? target;
      const written = m[2]! + (m[3] ?? '');
      const becomes = name + carried.params;
      if (written.replace(/\s+/g, '').toUpperCase() === becomes.replace(/\s+/g, '').toUpperCase()) return null;
      matched.add(written.replace(/\s+/g, '').toUpperCase());
      return m[1] + becomes;
    });
    if (replaced.count > 0) {
      out = replaced.sql;
      changes.push({ kind: 'type', from: [...matched].join(', '), to: target, count: replaced.count });
    }
  }

  return out;
}

const SET_OPERATOR = /\b(?:UNION|INTERSECT|EXCEPT|MINUS)\b/i;

/**
 * Translate every row cap between LIMIT, TOP and FETCH FIRST.
 *
 * Each cap is converted where it stands, against the SELECT at its own nesting level.
 * The first version found the first cap anywhere in the text, removed every one, and
 * appended one at the end — so `SELECT * FROM (… LIMIT 5) LIMIT 100` lost its inner
 * limit and quietly returned every row the subquery produced.
 */
function convertRowLimit(
  sql: string,
  from: Dialect,
  to: Dialect,
  changes: Change[],
  unconverted: Unconverted[],
): string {
  const fromStyle = rowLimitStyle(from);
  const toStyle = rowLimitStyle(to);
  const segments = scan(sql, from);
  const code = codeMap(sql, segments);
  const edits: Edit[] = [];
  const flag = (feature: string, why: string) => {
    if (!unconverted.some((u) => u.feature === feature)) unconverted.push({ feature, why });
  };
  let converted = 0;
  let lastFrom = '';
  let lastTo = '';

  const fetchClause = (count: string, offset: string | null) =>
    offset !== null ? `OFFSET ${offset} ROWS FETCH NEXT ${count} ROWS ONLY` : `FETCH FIRST ${count} ROWS ONLY`;
  const limitClause = (count: string, offset: string | null) =>
    `LIMIT ${count}${offset !== null ? ` OFFSET ${offset}` : ''}`;

  /** Put TOP n on the SELECT that owns the cap at `at`, or say why it cannot go. */
  const topFor = (at: number, count: string, label: string): Edit | null => {
    const group = groupAt(sql, code, at);
    const level = levelText(sql, code, group.start, at);
    const select = /\bSELECT\b/i.exec(level);
    if (!select) return null;
    if (SET_OPERATOR.test(level.slice(select.index))) {
      flag(
        `${label} on a UNION`,
        'The row cap applies to the whole UNION, and TOP can only sit on one of its SELECTs. Wrap the UNION in a subquery and put TOP on the outer SELECT.',
      );
      return null;
    }
    const afterSelect = group.start + select.index + select[0].length;
    const modifier = /^\s+(?:DISTINCT|ALL)\b/i.exec(sql.slice(afterSelect));
    const insertAt = afterSelect + (modifier ? modifier[0].length : 0);
    return { at: insertAt, remove: 0, insert: ` TOP ${count}` };
  };

  /** Where to add a trailing cap for the SELECT at `at`: the end of its group. */
  const appendFor = (at: number, clause: string, label: string): Edit | null => {
    const group = groupAt(sql, code, at);
    const level = levelText(sql, code, at, group.end);
    if (SET_OPERATOR.test(level)) {
      flag(
        `${label} before a UNION`,
        'The cap belongs to one SELECT inside a UNION, but a trailing clause would apply to the whole UNION. Wrap that SELECT in a subquery first.',
      );
      return null;
    }
    let end = group.end;
    while (end > group.start && /\s/.test(sql[end - 1]!)) end--;
    const gap = !group.paren && /\r?\n/.test(sql.slice(group.start, end)) ? '\n' : ' ';
    return { at: end, remove: 0, insert: gap + clause };
  };

  /** Remove [start, end) together with the whitespace before it. */
  const removal = (start: number, end: number): Edit => {
    let s = start;
    while (s > 0 && /[ \t\r\n]/.test(sql[s - 1]!)) s--;
    return { at: s, remove: end - s, insert: '' };
  };

  const record = (fromText: string, toText: string) => {
    converted++;
    lastFrom = fromText;
    lastTo = toText;
  };

  if (fromStyle === 'limit') {
    for (const m of codeMatches(sql, from, /\bLIMIT\b/gi)) {
      const clause = /^LIMIT\s+(?:(\d+)\s*,\s*(\d+)|(\d+)(?:\s+OFFSET\s+(\d+))?)/i.exec(sql.slice(m.index));
      if (!clause) {
        if (toStyle !== 'limit') {
          flag(
            'LIMIT with an expression',
            `The row count is not a plain number, so it cannot be moved into ${STYLE_LABEL[toStyle]} mechanically. Rewrite the clause by hand.`,
          );
        }
        continue;
      }
      // MySQL's LIMIT offset, count puts the numbers the other way round.
      const commaForm = clause[1] !== undefined;
      const count = (commaForm ? clause[2] : clause[3])!;
      const offset = (commaForm ? clause[1] : clause[4]) ?? null;
      const span = { at: m.index, remove: clause[0].length };

      if (toStyle === 'limit') {
        if (commaForm && !['mysql', 'mariadb'].includes(to.id)) {
          edits.push({ ...span, insert: limitClause(count, offset) });
          record(`LIMIT ${offset}, ${count}`, limitClause(count, offset));
        }
        continue;
      }
      if (toStyle === 'fetch') {
        edits.push({ ...span, insert: fetchClause(count, offset) });
        record(`LIMIT ${count}`, fetchClause(count, offset));
        continue;
      }
      if (offset !== null) {
        flag(
          'LIMIT with an offset',
          'SQL Server writes an offset as OFFSET n ROWS FETCH NEXT m ROWS ONLY, and only accepts it after an ORDER BY. Add the ordering the paging depends on, then write the clause by hand.',
        );
        continue;
      }
      const top = topFor(m.index, count, 'LIMIT');
      if (!top) continue;
      edits.push(top, removal(m.index, m.index + clause[0].length));
      record(`LIMIT ${count}`, `TOP ${count}`);
    }
  } else if (fromStyle === 'top') {
    if (toStyle !== 'top') {
      for (const m of codeMatches(sql, from, /\bTOP\b/gi)) {
        const before = sql.slice(Math.max(0, m.index - 20), m.index);
        if (!/\bSELECT\s+(?:(?:DISTINCT|ALL)\s+)?$/i.test(before)) continue;
        const clause = /^TOP\s*(?:\(\s*(\d+)\s*\)|(\d+))(\s+PERCENT)?(\s+WITH\s+TIES)?\s*/i.exec(sql.slice(m.index));
        if (!clause) {
          flag('TOP with an expression', 'The row count is a variable or expression, so it cannot be moved mechanically. Rewrite the row cap by hand.');
          continue;
        }
        if (clause[3] || clause[4]) {
          flag(
            clause[3] ? 'TOP … PERCENT' : 'TOP … WITH TIES',
            clause[3]
              ? 'A percentage of rows has no LIMIT equivalent. Count the rows first, or use a window function to rank them and filter on the rank.'
              : 'Ties are only kept by engines that support FETCH FIRST … WITH TIES. Elsewhere, rank with a window function and filter on the rank.',
          );
          continue;
        }
        const count = (clause[1] ?? clause[2])!;
        const trailing = toStyle === 'limit' ? limitClause(count, null) : fetchClause(count, null);
        const append = appendFor(m.index, trailing, 'TOP');
        if (!append) continue;
        edits.push({ at: m.index, remove: clause[0].length, insert: '' }, append);
        record(`TOP ${count}`, trailing);
      }
    }
  } else if (toStyle !== 'fetch') {
    const FETCH = /(?:\bOFFSET\s+(\d+)\s+ROWS?\s+)?\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY/gi;
    for (const m of codeMatches(sql, from, FETCH)) {
      const offset = m[1] ?? null;
      const count = m[2]!;
      if (toStyle === 'limit') {
        edits.push({ at: m.index, remove: m[0].length, insert: limitClause(count, offset) });
        record(`FETCH FIRST ${count}`, limitClause(count, offset));
        continue;
      }
      if (offset !== null) {
        flag('FETCH FIRST with an offset', 'Keep the OFFSET … FETCH NEXT clause: SQL Server accepts it after an ORDER BY, which TOP cannot express.');
        continue;
      }
      const top = topFor(m.index, count, 'FETCH FIRST');
      if (!top) continue;
      edits.push(top, removal(m.index, m.index + m[0].length));
      record(`FETCH FIRST ${count}`, `TOP ${count}`);
    }
  }

  if (converted === 0) return sql;
  changes.push({
    kind: 'rows',
    from: converted === 1 ? lastFrom : STYLE_LABEL[fromStyle],
    to: converted === 1 ? lastTo : STYLE_LABEL[toStyle],
    count: converted,
  });
  return applyEdits(sql, edits);
}

/* ------------------------------------------------------------------------ api */

export function convertSql(sql: string, from: Dialect, to: Dialect): ConvertResult {
  if (sql.trim() === '' || from.id === to.id) {
    return { sql, changes: [], unconverted: [] };
  }

  const changes: Change[] = [];
  const unconverted: Unconverted[] = [];

  // Hazards are read from the source as written, before any rewriting could hide
  // them — a string literal is still a string literal in the source's own terms.
  for (const hazard of HAZARDS) {
    if (hazard.safeIn?.includes(to.id)) continue;
    if (hazard.applies && !hazard.applies(from, to)) continue;
    const found = codeMatches(sql, from, hazard.pattern);
    if (found.length === 0) continue;
    const feature = hazard.listMatches
      ? `${hazard.feature} (${[...new Set(found.map((m) => m[0].toUpperCase()))].join(', ')})`
      : hazard.feature;
    if (unconverted.some((u) => u.feature === feature)) continue;
    unconverted.push({
      feature,
      why: typeof hazard.why === 'function' ? hazard.why(from, to) : hazard.why,
    });
  }

  let out = convertRowLimit(sql, from, to, changes, unconverted);
  out = convertLiterals(out, from, to, changes);
  out = convertFunctions(out, from, to, changes, unconverted);
  out = convertTypes(out, from, to, changes);

  return { sql: out, changes, unconverted };
}
