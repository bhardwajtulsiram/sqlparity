import type { Dialect } from './dialects';
import { escapeStringBody } from './escape';
import { isInLiteral, scan } from './tokenize';

/**
 * Mechanical dialect translation.
 *
 * The competing tools do this by asking a language model, which works well and
 * requires sending them your query. That is the one thing this tool will not do, so
 * what is here is a rewriter: quoting rules, string escaping, row limits, and a table
 * of functions that differ only in name.
 *
 * The interesting design decision is what it refuses to touch. A rename is only safe
 * when the two functions take the same arguments in the same order. CHARINDEX and
 * STRPOS look interchangeable and have their arguments reversed; DATEDIFF exists in
 * several dialects with different meanings. Renaming those produces SQL that runs and
 * returns wrong answers — the worst possible outcome, and one you would not catch in
 * review. So they are reported as unconverted instead, with the reason.
 *
 * Everything it changed and everything it could not is returned alongside the SQL.
 * A converter you have to trust blindly is not useful for data you care about.
 */

export type ChangeKind = 'quoting' | 'escaping' | 'function' | 'type' | 'rows';

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

/* ------------------------------------------------------------------ functions */

/**
 * Functions that differ only in spelling.
 *
 * A family may only live here if every listed spelling takes the same arguments in
 * the same order. `null` means the dialect has no same-shape equivalent, which makes
 * the family unconvertible into it rather than a guess.
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
}

const FUNCTIONS: FunctionFamily[] = [
  {
    // LEN is T-SQL's only spelling; everywhere else LENGTH is right.
    names: { transactsql: 'LEN' },
    fallback: 'LENGTH',
  },
  {
    names: {
      postgresql: 'SUBSTRING',
      transactsql: 'SUBSTRING',
      redshift: 'SUBSTRING',
      db2: 'SUBSTRING',
      clickhouse: 'SUBSTRING',
    },
    fallback: 'SUBSTR',
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
const NOW_PATTERN = /\b(?:GETDATE\s*\(\s*\)|NOW\s*\(\s*\)|SYSDATE\b|CURRENT_TIMESTAMP\b)/gi;

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
}

const TYPE_FAMILIES: TypeFamily[] = [
  {
    members: ['VARCHAR', 'STRING', 'TEXT', 'NVARCHAR'],
    names: {
      bigquery: 'STRING',
      hive: 'STRING',
      spark: 'STRING',
      sqlite: 'TEXT',
      clickhouse: 'String',
    },
    fallback: 'VARCHAR',
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

/**
 * Constructs that are detected but never rewritten. Each is here because the obvious
 * mechanical translation is wrong often enough to be dangerous.
 */
interface Hazard {
  pattern: RegExp;
  feature: string;
  why: string;
  /** Targets that understand it as written, where there is nothing to report. */
  safeIn?: string[];
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
    pattern: /\b(?:GROUP_CONCAT|STRING_AGG|LISTAGG)\s*\(/i,
    feature: 'String aggregation',
    why: 'GROUP_CONCAT, STRING_AGG and LISTAGG express the separator and the ordering differently enough that the arguments have to be rebuilt, not renamed.',
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
    why: 'Outside MySQL and MariaDB this operator does not exist. The equivalent is NOT (a IS DISTINCT FROM b), which means rewriting the expression around it.',
    safeIn: ['mysql', 'mariadb'],
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
  replacer: (match: RegExpExecArray) => string | null,
): { sql: string; count: number } {
  const segments = scan(sql, dialect);
  const re = global(pattern);
  let out = '';
  let last = 0;
  let count = 0;

  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    if (isInLiteral(segments, m.index)) continue;
    const replacement = replacer(m);
    if (replacement === null || replacement === m[0]) continue;
    out += sql.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
    count++;
  }

  return { sql: out + sql.slice(last), count };
}

/** True when a regex matches somewhere outside a string, comment or quoted identifier. */
function matchesCode(sql: string, dialect: Dialect, pattern: RegExp): boolean {
  const segments = scan(sql, dialect);
  const re = global(pattern);
  for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
    if (!isInLiteral(segments, m.index)) return true;
  }
  return false;
}

/** Recover the text a source string literal actually stands for. */
function decodeStringBody(body: string, from: Dialect): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (from.backslashIsEscape && ch === '\\' && i + 1 < body.length) {
      out += body[i + 1];
      i++;
      continue;
    }
    if (ch === "'" && body[i + 1] === "'") {
      out += "'";
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Re-quote identifiers and re-escape string literals for the target dialect. */
function convertLiterals(sql: string, from: Dialect, to: Dialect, changes: Change[]): string {
  const sameIdent =
    from.identifier.open === to.identifier.open && from.identifier.close === to.identifier.close;
  const sameString =
    from.quoteEscape === to.quoteEscape && from.backslashIsEscape === to.backslashIsEscape;
  if (sameIdent && sameString) return sql;

  let identifiers = 0;
  let strings = 0;

  const out = scan(sql, from)
    .map((segment) => {
      if (segment.kind === 'identifier' && !sameIdent) {
        const inner = segment.text
          .slice(1, -1)
          .replaceAll(from.identifier.escapeClose, from.identifier.close);
        identifiers++;
        return (
          to.identifier.open +
          inner.replaceAll(to.identifier.close, to.identifier.escapeClose) +
          to.identifier.close
        );
      }
      if (segment.kind === 'string' && !sameString) {
        // An unterminated literal at the end of the input has no closing quote to trim.
        const closed = segment.text.length > 1 && segment.text.endsWith("'");
        const body = closed ? segment.text.slice(1, -1) : segment.text.slice(1);
        const requoted = "'" + escapeStringBody(decodeStringBody(body, from), to) + "'";
        if (requoted !== segment.text) strings++;
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
  if (strings > 0) {
    changes.push({
      kind: 'escaping',
      from: from.quoteEscape === 'double' ? "''" : "\\'",
      to: to.quoteEscape === 'double' ? "''" : "\\'",
      count: strings,
    });
  }
  return out;
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
      if (family.why && matchesCode(out, to, pattern)) {
        unconverted.push({ feature: spellings[0], why: family.why });
      }
      continue;
    }

    // Report what was actually found. Several spellings share one family, and naming
    // the wrong one produces a change line reading COALESCE() -> COALESCE().
    const matched = new Set<string>();
    const replaced = replaceInCode(out, to, pattern, (m) => {
      if (m[1].toUpperCase() === target.toUpperCase()) return null;
      matched.add(m[1].toUpperCase());
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
  }

  const nowTarget = NOW_SPELLING[to.id] ?? NOW_DEFAULT;
  const bare = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const now = replaceInCode(out, to, NOW_PATTERN, (m) =>
    bare(m[0]) === bare(nowTarget) ? null : nowTarget,
  );
  if (now.count > 0) {
    out = now.sql;
    changes.push({ kind: 'function', from: 'current timestamp', to: nowTarget, count: now.count });
  }

  return out;
}

/** Rewrite type names inside CAST, where the two dialects spell the same type differently. */
function convertTypes(sql: string, from: Dialect, to: Dialect, changes: Change[]): string {
  let out = sql;

  for (const family of TYPE_FAMILIES) {
    const target = family.names[to.id] ?? family.fallback;
    const sourceName = family.names[from.id] ?? family.fallback;
    const spellings = [...new Set([sourceName, ...family.members])];
    // Anchored on AS so this only touches CAST(x AS t), not a bare column named text.
    const pattern = new RegExp('(\\bAS\\s+)(' + spellings.join('|') + ')\\b', 'gi');

    const matched = new Set<string>();
    const replaced = replaceInCode(out, to, pattern, (m) => {
      if (m[2].toUpperCase() === target.toUpperCase()) return null;
      matched.add(m[2].toUpperCase());
      return m[1] + target;
    });
    if (replaced.count > 0) {
      out = replaced.sql;
      changes.push({ kind: 'type', from: [...matched].join(', '), to: target, count: replaced.count });
    }
  }

  return out;
}

/** Put a trailing clause before the statement terminator, not after it. */
function appendClause(sql: string, clause: string): string {
  const trimmed = sql.replace(/\s+$/, '');
  // Match how the query is already laid out rather than always running the clause on.
  const gap = /\r?\n/.test(trimmed) ? '\n' : ' ';
  if (trimmed.endsWith(';')) {
    return trimmed.slice(0, -1).replace(/\s+$/, '') + gap + clause + ';';
  }
  return trimmed + gap + clause;
}

/**
 * Tidy up after a removed clause.
 *
 * Deliberately minimal: the clause patterns take their own leading whitespace with
 * them, so there is nothing to close up in the body. Collapsing runs of spaces here
 * would flatten the indentation of every line the author wrote.
 */
function tidy(sql: string): string {
  return sql.replace(/[ \t]+(\r?\n)/g, '$1').replace(/\s+;/g, ';').replace(/\s+$/, '');
}

/** Translate the row cap between LIMIT, TOP and FETCH FIRST. */
function convertRowLimit(
  sql: string,
  from: Dialect,
  to: Dialect,
  changes: Change[],
  unconverted: Unconverted[],
): string {
  const fromStyle = rowLimitStyle(from);
  const toStyle = rowLimitStyle(to);
  if (fromStyle === toStyle) return sql;

  const LIMIT_RE = /\s*\bLIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i;
  const TOP_RE = /\bSELECT\s+(DISTINCT\s+)?TOP\s*(?:\(\s*)?(\d+)(?:\s*\))?/i;
  const FETCH_RE = /\s*(?:\bOFFSET\s+(\d+)\s+ROWS?\s+)?\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+ONLY/i;

  let count: string | null = null;
  let offset: string | null = null;
  let stripped = sql;

  if (fromStyle === 'limit') {
    stripped = replaceInCode(sql, from, LIMIT_RE, (m) => {
      count = m[1];
      offset = m[2] ?? null;
      return '';
    }).sql;
  } else if (fromStyle === 'top') {
    stripped = replaceInCode(sql, from, TOP_RE, (m) => {
      count = m[2];
      return ('SELECT ' + (m[1] ?? '')).trimEnd();
    }).sql;
  } else {
    stripped = replaceInCode(sql, from, FETCH_RE, (m) => {
      offset = m[1] ?? null;
      count = m[2];
      return '';
    }).sql;
  }

  // No row cap in the query, so there is nothing to move.
  if (count === null) return sql;

  if (toStyle === 'top') {
    if (offset !== null) {
      unconverted.push({
        feature: STYLE_LABEL[fromStyle] + ' with an offset',
        why: 'SQL Server writes an offset as OFFSET n ROWS FETCH NEXT m ROWS ONLY, and only accepts it after an ORDER BY. Add the ordering the paging depends on, then write the clause by hand.',
      });
      return sql;
    }
    const selects = (stripped.match(/\bSELECT\b/gi) ?? []).length;
    if (selects !== 1) {
      unconverted.push({
        feature: STYLE_LABEL[fromStyle] + ' in a query with more than one SELECT',
        why: 'TOP attaches to one particular SELECT, and which one the row cap applied to cannot be told from the text. Add TOP to the SELECT you meant.',
      });
      return sql;
    }
    const out = stripped.replace(
      /\bSELECT\s+(DISTINCT\s+)?/i,
      (_m, distinct: string | undefined) => 'SELECT ' + (distinct ?? '') + 'TOP ' + count + ' ',
    );
    changes.push({
      kind: 'rows',
      from: STYLE_LABEL[fromStyle] + ' ' + count,
      to: 'TOP ' + count,
      count: 1,
    });
    return tidy(out);
  }

  const clause =
    toStyle === 'limit'
      ? 'LIMIT ' + count + (offset !== null ? ' OFFSET ' + offset : '')
      : (offset !== null ? 'OFFSET ' + offset + ' ROWS FETCH NEXT ' : 'FETCH FIRST ') +
        count +
        ' ROWS ONLY';

  changes.push({
    kind: 'rows',
    from: STYLE_LABEL[fromStyle] + ' ' + count,
    to: clause,
    count: 1,
  });
  return tidy(appendClause(stripped, clause));
}

/* ------------------------------------------------------------------------ api */

export function convertSql(sql: string, from: Dialect, to: Dialect): ConvertResult {
  if (sql.trim() === '' || from.id === to.id) {
    return { sql, changes: [], unconverted: [] };
  }

  const changes: Change[] = [];
  const unconverted: Unconverted[] = [];

  let out = convertLiterals(sql, from, to, changes);
  out = convertFunctions(out, from, to, changes, unconverted);
  out = convertTypes(out, from, to, changes);
  out = convertRowLimit(out, from, to, changes, unconverted);

  for (const hazard of HAZARDS) {
    if (hazard.safeIn?.includes(to.id)) continue;
    if (unconverted.some((u) => u.feature === hazard.feature)) continue;
    if (!matchesCode(out, to, hazard.pattern)) continue;
    unconverted.push({ feature: hazard.feature, why: hazard.why });
  }

  return { sql: out, changes, unconverted };
}
