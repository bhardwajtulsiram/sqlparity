import type { Dialect } from './dialects';
import { splitStatements } from './tokenize';

/**
 * Cheap, high-precision safety checks — not a linter in the general sense.
 *
 * This deliberately does not attempt "missing LIMIT" or "cross join" detection: both
 * have too many legitimate uses (aggregates, intentional full scans, comma joins in
 * older code) to warn on without a high false-positive rate. What is here is narrow:
 * a small set of statements that are irreversible or table-wide by construction, where
 * a warning is very unlikely to be wrong.
 */

export interface LintFinding {
  rule: string;
  message: string;
}

function lintStatement(code: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const hasWhere = /\bWHERE\b/i.test(code);

  // \b on "UPDATE"/"DELETE" already keeps this from matching inside an identifier
  // like updated_at or last_deleted_flag, since the boundary needs a non-word
  // character on both sides and underscore counts as a word character.
  if (/\bUPDATE\b/i.test(code) && /\bSET\b/i.test(code) && !hasWhere) {
    findings.push({
      rule: 'update-without-where',
      message: 'This UPDATE has no WHERE clause — it will change every row in the table.',
    });
  }

  if (/\bDELETE\s+FROM\b/i.test(code) && !hasWhere) {
    findings.push({
      rule: 'delete-without-where',
      message: 'This DELETE has no WHERE clause — it will remove every row in the table.',
    });
  }

  if (/\bTRUNCATE\b/i.test(code)) {
    findings.push({
      rule: 'truncate',
      message: 'TRUNCATE removes every row in the table and cannot be undone.',
    });
  }

  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i.test(code)) {
    findings.push({
      rule: 'drop',
      message: 'This drops a table, database, or schema — that cannot be undone.',
    });
  }

  return findings;
}

export function lintSql(sql: string, dialect: Dialect): LintFinding[] {
  if (sql.trim() === '') return [];
  return splitStatements(sql, dialect).flatMap(lintStatement);
}
