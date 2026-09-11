/**
 * Dialect registry.
 *
 * The two escaping flags below are the highest-risk data in this codebase: a wrong
 * value produces SQL that runs successfully and returns the wrong rows. Every entry
 * is covered by tests in tests/escape.test.ts.
 *
 *   quoteEscape       How a literal single quote inside a string is escaped.
 *                     'double'    -> ''   (standard SQL, accepted almost everywhere)
 *                     'backslash' -> \'   (only where doubling is NOT supported)
 *
 *   backslashIsEscape Whether the dialect treats \ as an escape character inside an
 *                     ordinary string literal. When true, a literal backslash must be
 *                     doubled or the value silently changes meaning (\n becomes a
 *                     newline, \0 becomes NUL, and so on).
 */

export type QuoteEscape = 'double' | 'backslash';

export interface IdentifierQuoting {
  open: string;
  close: string;
  /** How an occurrence of the closing delimiter inside an identifier is escaped. */
  escapeClose: string;
}

export interface Dialect {
  id: string;
  label: string;
  /** Alternate names users may search for; matched case-insensitively. */
  aliases: string[];
  /** Named export to import from sql-formatter (see lib/format.ts). */
  formatter: string;
  quoteEscape: QuoteEscape;
  backslashIsEscape: boolean;
  identifier: IdentifierQuoting;
  /** Line-comment markers this dialect understands, longest first. */
  lineComments: string[];
  /** Hard limit on IN-list length, where the dialect imposes one. */
  maxInListSize?: number;
  /** Null-safe inequality, used by the generator. undefined = dialect has none. */
  nullSafeNotEqual?: (a: string, b: string) => string;
  notes?: string;
}

const DOUBLE_QUOTE_IDENT: IdentifierQuoting = { open: '"', close: '"', escapeClose: '""' };
const BACKTICK_IDENT: IdentifierQuoting = { open: '`', close: '`', escapeClose: '``' };
const BRACKET_IDENT: IdentifierQuoting = { open: '[', close: ']', escapeClose: ']]' };

const isDistinctFrom = (a: string, b: string) => `${a} IS DISTINCT FROM ${b}`;

/**
 * Ordered most-used first, not alphabetically and not by what this project was built
 * for. Every list of dialects in the app — the pickers, the hero switcher, the wall on
 * the home page — maps this array, so reordering here reorders all of them.
 *
 * The ranking leans on developer-usage surveys rather than the enterprise-install
 * rankings, because the people reaching for a SQL formatter are the ones writing the
 * queries. Standard SQL sits last as the fallback rather than a product.
 */
export const DIALECTS: Dialect[] = [
  {
    id: 'postgresql',
    label: 'PostgreSQL',
    aliases: ['postgres', 'postgresql', 'pg'],
    formatter: 'postgresql',
    // standard_conforming_strings has defaulted to on since 9.1, so backslash is literal.
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'mysql',
    label: 'MySQL',
    aliases: ['mysql'],
    formatter: 'mysql',
    // MySQL accepts both '' and \'. Doubling is preferred: portable, and unaffected by
    // NO_BACKSLASH_ESCAPES. Backslash still needs doubling under the default sql_mode.
    quoteEscape: 'double',
    backslashIsEscape: true,
    identifier: BACKTICK_IDENT,
    lineComments: ['-- ', '#'],
    nullSafeNotEqual: (a, b) => `NOT (${a} <=> ${b})`,
    notes: 'MySQL has no IS DISTINCT FROM; <=> is the null-safe equality operator.',
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    aliases: ['sqlite'],
    formatter: 'sqlite',
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'transactsql',
    label: 'SQL Server (T-SQL)',
    aliases: ['mssql', 'sqlserver', 'tsql', 'transactsql'],
    formatter: 'transactsql',
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: BRACKET_IDENT,
    lineComments: ['--'],
    notes: 'SQL Server has no IS DISTINCT FROM before 2022; use explicit IS NULL comparisons.',
  },
  {
    id: 'plsql',
    label: 'Oracle',
    aliases: ['oracle', 'plsql'],
    formatter: 'plsql',
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    maxInListSize: 1000,
    notes: 'Oracle raises ORA-01795 above 1000 expressions in an IN list.',
  },
  {
    id: 'mariadb',
    label: 'MariaDB',
    aliases: ['mariadb'],
    formatter: 'mariadb',
    quoteEscape: 'double',
    backslashIsEscape: true,
    identifier: BACKTICK_IDENT,
    lineComments: ['-- ', '#'],
  },
  {
    id: 'snowflake',
    label: 'Snowflake',
    aliases: ['snowflake'],
    formatter: 'snowflake',
    quoteEscape: 'double',
    backslashIsEscape: true,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--', '//'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'bigquery',
    label: 'Google BigQuery',
    aliases: ['bigquery', 'bq'],
    formatter: 'bigquery',
    // BigQuery documents backslash escapes; quote doubling is not a documented escape.
    quoteEscape: 'backslash',
    backslashIsEscape: true,
    identifier: BACKTICK_IDENT,
    lineComments: ['--', '#'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'redshift',
    label: 'Amazon Redshift',
    aliases: ['redshift'],
    formatter: 'redshift',
    // Redshift treats backslash as an escape character in string literals.
    quoteEscape: 'double',
    backslashIsEscape: true,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'trino',
    label: 'Amazon Athena / Trino',
    aliases: ['athena', 'presto', 'trino'],
    formatter: 'trino',
    // Trino follows the SQL standard: backslash is an ordinary character.
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
    notes:
      'Athena engine v3 tracks recent Trino. IS DISTINCT FROM is supported, but fails on ARRAY columns containing null elements.',
  },
  {
    id: 'spark',
    label: 'Apache Spark SQL',
    aliases: ['spark', 'sparksql', 'databricks'],
    formatter: 'spark',
    quoteEscape: 'backslash',
    backslashIsEscape: true,
    identifier: BACKTICK_IDENT,
    lineComments: ['--'],
  },
  {
    id: 'hive',
    label: 'Apache Hive',
    aliases: ['hive'],
    formatter: 'hive',
    quoteEscape: 'backslash',
    backslashIsEscape: true,
    identifier: BACKTICK_IDENT,
    lineComments: ['--'],
  },
  {
    id: 'clickhouse',
    label: 'ClickHouse',
    aliases: ['clickhouse'],
    formatter: 'clickhouse',
    quoteEscape: 'double',
    backslashIsEscape: true,
    identifier: BACKTICK_IDENT,
    lineComments: ['--'],
  },
  {
    id: 'duckdb',
    label: 'DuckDB',
    aliases: ['duckdb'],
    formatter: 'duckdb',
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'db2',
    label: 'IBM Db2',
    aliases: ['db2'],
    formatter: 'db2',
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
  },
  {
    id: 'sql',
    label: 'Standard SQL',
    aliases: ['ansi', 'standard', 'sql'],
    formatter: 'sql',
    quoteEscape: 'double',
    backslashIsEscape: false,
    identifier: DOUBLE_QUOTE_IDENT,
    lineComments: ['--'],
    nullSafeNotEqual: isDistinctFrom,
  },
];

/** The dialect selected on first visit. */
export const DEFAULT_DIALECT_ID = 'postgresql';

const BY_KEY = new Map<string, Dialect>();
for (const d of DIALECTS) {
  BY_KEY.set(d.id.toLowerCase(), d);
  for (const alias of d.aliases) BY_KEY.set(alias.toLowerCase(), d);
}

export function getDialect(idOrAlias: string): Dialect {
  const found = BY_KEY.get(idOrAlias.trim().toLowerCase());
  if (!found) throw new Error(`Unknown SQL dialect: ${idOrAlias}`);
  return found;
}

export function tryGetDialect(idOrAlias: string): Dialect | undefined {
  return BY_KEY.get(idOrAlias.trim().toLowerCase());
}
