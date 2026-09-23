import type { Dialect } from './dialects';
import { quoteIdentifier } from './escape';

/**
 * When a column name can be written bare, and how to write it when it cannot.
 *
 * Generated SQL writes every name bare by default, because that is what a person
 * would write and what reads best. But a real schema has columns called `order`,
 * `user` and `date`, and CSV-born ones called `Customer Name`, and writing those bare
 * produces a query that does not parse — or, for a mixed-case name in PostgreSQL,
 * one that parses and looks up a different column.
 */

/**
 * Words reserved in at least one of the supported dialects, where a bare column of
 * that name is a syntax error. Quoting a word that turns out to be allowed is
 * harmless; missing one that is not produces a query that fails.
 */
const RESERVED = new Set(
  `ALL ALTER AND ANY ARRAY AS ASC AUTHORIZATION BETWEEN BOTH BY CASE CAST CHECK COLLATE COLUMN
  CONSTRAINT CREATE CROSS CUBE CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER
  DATABASE DATE DEFAULT DELETE DESC DESCRIBE DISTINCT DIV DROP ELSE END ESCAPE EXCEPT EXISTS
  EXTRACT FALSE FETCH FOR FOREIGN FROM FULL FUNCTION GRANT GROUP GROUPING HAVING IF IN INDEX
  INNER INSERT INTERSECT INTERVAL INTO IS JOIN KEY LATERAL LEADING LEFT LIKE LIMIT LOCALTIME
  LOCALTIMESTAMP MINUS NATURAL NOT NULL OF OFFSET ON ONLY OR ORDER OUTER OVER PARTITION PRIMARY
  QUALIFY RANGE RECURSIVE REFERENCES REGEXP RIGHT RLIKE ROLLUP ROW ROWS SCHEMA SELECT
  SESSION_USER SET SOME TABLE THEN TIME TIMESTAMP TO TOP TRAILING TRUE UNION UNIQUE UNNEST
  UPDATE USER USING VALUES WHEN WHERE WINDOW WITH`.split(/\s+/),
);

const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Dialects that fold an unquoted name to lower case, where quoting makes case matter. */
const FOLDS_LOWER = new Set(['postgresql', 'redshift']);
/** Dialects that fold an unquoted name to upper case. */
const FOLDS_UPPER = new Set(['snowflake', 'plsql', 'db2']);

/** True when a name cannot be written bare. */
export function needsQuoting(name: string): boolean {
  return !PLAIN.test(name) || RESERVED.has(name.toUpperCase());
}

/** True when the text is already a name wrapped in the dialect's own quotes. */
export function isQuotedName(text: string, dialect: Dialect): boolean {
  const { open, close } = dialect.identifier;
  return text.length >= 2 && text.startsWith(open) && text.endsWith(close);
}

/** The name inside the dialect's quotes, or the text unchanged when it is not quoted. */
export function unquoteName(text: string, dialect: Dialect): string {
  if (!isQuotedName(text, dialect)) return text;
  const { close, escapeClose } = dialect.identifier;
  return text.slice(1, -1).replaceAll(escapeClose, close);
}

/**
 * A name as it should appear in generated SQL.
 *
 * A name that is already quoted is taken as meant. A bare name is left bare when it
 * can be; when it cannot, it is quoted — and a plain word that only needs quoting
 * because it is reserved is first folded to the case the dialect stores unquoted names
 * in, so `order` in Snowflake becomes `"ORDER"`, which is the column `CREATE TABLE t
 * (order int)` actually made.
 */
export function renderName(text: string, dialect: Dialect): string {
  const name = text.trim();
  if (name === '' || isQuotedName(name, dialect)) return name;
  if (!needsQuoting(name)) return name;
  let inner = name;
  if (PLAIN.test(name)) {
    if (FOLDS_LOWER.has(dialect.id)) inner = name.toLowerCase();
    else if (FOLDS_UPPER.has(dialect.id)) inner = name.toUpperCase();
  }
  return quoteIdentifier(inner, dialect);
}

/**
 * How a name read out of a CREATE TABLE should be written into the field box.
 *
 * The DDL records whether the name was quoted, and in the dialects that fold case
 * that decides which column it is: `"CustomerId"` in PostgreSQL is not the column
 * `CustomerId` written bare. Such names go into the box already quoted, so the
 * spelling survives. Everything else goes in bare — a quoted `customer_id` from
 * Athena's SHOW CREATE TABLE is just `customer_id`.
 */
export function nameForList(name: string, quoted: boolean | undefined, dialect: Dialect): string {
  if (!quoted) return name;
  const caseMatters =
    (FOLDS_LOWER.has(dialect.id) && name !== name.toLowerCase()) ||
    (FOLDS_UPPER.has(dialect.id) && name !== name.toUpperCase());
  if (caseMatters) return quoteIdentifier(name, dialect);
  return name;
}
