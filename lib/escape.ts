import type { Dialect } from './dialects';

/**
 * Escape the interior of a single-quoted string literal for a dialect.
 *
 * Order matters and is not interchangeable: backslashes must be doubled BEFORE
 * quotes are escaped. If quotes were escaped first in a backslash-escaping dialect,
 * the backslash introduced by \' would itself be doubled, producing a literal
 * backslash followed by an unescaped quote.
 */
export function escapeStringBody(value: string, dialect: Dialect): string {
  let out = value;
  if (dialect.backslashIsEscape) {
    out = out.replaceAll('\\', '\\\\');
  }
  out = dialect.quoteEscape === 'double' ? out.replaceAll("'", "''") : out.replaceAll("'", "\\'");
  return out;
}

/** Render a value as a complete quoted string literal, escaping as the dialect requires. */
export function quoteString(value: string, dialect: Dialect): string {
  return `'${escapeStringBody(value, dialect)}'`;
}

/** Render an identifier (column, table) with the dialect's quoting characters. */
export function quoteIdentifier(name: string, dialect: Dialect): string {
  const { open, close, escapeClose } = dialect.identifier;
  return open + name.replaceAll(close, escapeClose) + close;
}

/**
 * A conservative numeric test used for auto-detection.
 *
 * Values with insignificant leading zeros are deliberately NOT treated as numeric.
 * Identifiers like "007" or "0123" are almost always strings, and emitting them
 * unquoted would silently drop the zeros and match the wrong rows.
 */
const NUMERIC_RE = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$|^[+-]?\.\d+(?:[eE][+-]?\d+)?$/;

export function isNumericLiteral(value: string): boolean {
  return NUMERIC_RE.test(value.trim());
}

/**
 * A number as people write one in a list of values: no leading `+`, no exponent.
 *
 * `+14155552671` is a phone number and `1E5` is a product code far more often than
 * either is a number, and writing them unquoted turns them into 14155552671 and
 * 100000. Auto mode only leaves this narrower shape unquoted.
 */
const PLAIN_NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$|^-?\.\d+$/;

export function isPlainNumber(value: string): boolean {
  return PLAIN_NUMBER_RE.test(value.trim());
}

/** True when a value has a leading zero that would be lost if emitted as a number. */
export function hasSignificantLeadingZero(value: string): boolean {
  return /^[+-]?0\d/.test(value.trim());
}

/** The bare token `NULL`, in any casing. An IN list can never match it. */
export function isNullLiteral(value: string): boolean {
  return value.trim().toUpperCase() === 'NULL';
}

export type ValueMode = 'auto' | 'string' | 'numeric';

/**
 * Render one value for inclusion in an IN list.
 *
 * In 'auto' mode a value is emitted unquoted only when it is unambiguously numeric.
 * In 'numeric' mode a non-numeric value still falls back to a quoted string rather
 * than producing invalid SQL.
 */
export function renderValue(value: string, dialect: Dialect, mode: ValueMode): string {
  if (mode === 'string') return quoteString(value, dialect);
  const numeric = mode === 'auto' ? isPlainNumber(value) : isNumericLiteral(value);
  if (numeric) return value.trim();
  return quoteString(value, dialect);
}
