import type { DdlColumn } from './ddl';
import { normalizeType } from './typemap';

/**
 * Check a field list against a known schema.
 *
 * The field list and the schema can disagree in three ways that matter, and they mean
 * different things:
 *
 *   unknown       A field you are about to generate queries for does not exist in the
 *                 schema at all. Either a typo, or the column was dropped. This is the
 *                 one that produces queries that fail outright when you run them.
 *   typeMismatch  The field exists, but your list says a different type than the
 *                 schema does. Only reported when the difference would change the SQL
 *                 that gets generated — a `varchar(50)` against a `varchar(100)` picks
 *                 the same sentinel, so it is not worth interrupting for.
 *   uncovered     A column in the schema that your list does not mention. Not an error
 *                 — you may be checking a deliberate subset — but worth surfacing when
 *                 you meant to cover everything.
 *
 * Names are matched case-insensitively, which is how unquoted identifiers behave in
 * every dialect here.
 */

export interface TypeMismatch {
  name: string;
  /** The type as written in the field list. */
  listed: string;
  /** The type as declared in the schema. */
  actual: string;
}

export interface SchemaCheckResult {
  unknown: string[];
  typeMismatches: TypeMismatch[];
  uncovered: string[];
  /** Fields that were found in the schema, type agreeing (or untyped in the list). */
  matched: number;
  /** True when the list is fully accounted for: nothing unknown, no type conflicts. */
  clean: boolean;
}

export interface ListedField {
  name: string;
  /** Optional: a field list may be names only, with no type column. */
  type?: string;
}

const EMPTY: SchemaCheckResult = {
  unknown: [],
  typeMismatches: [],
  uncovered: [],
  matched: 0,
  clean: true,
};

export function checkFieldsAgainstSchema(
  fields: ListedField[],
  schema: DdlColumn[],
): SchemaCheckResult {
  if (fields.length === 0 || schema.length === 0) return { ...EMPTY };

  const schemaByName = new Map<string, DdlColumn>();
  for (const column of schema) {
    schemaByName.set(column.name.trim().toLowerCase(), column);
  }

  const unknown: string[] = [];
  const typeMismatches: TypeMismatch[] = [];
  const seen = new Set<string>();
  let matched = 0;

  for (const field of fields) {
    const name = field.name.trim();
    if (name === '') continue;

    const key = name.toLowerCase();
    seen.add(key);

    const column = schemaByName.get(key);
    if (!column) {
      unknown.push(name);
      continue;
    }

    const listedType = (field.type ?? '').trim();
    if (listedType === '') {
      // A names-only list has nothing to disagree with.
      matched++;
      continue;
    }

    // Compare on the normalized type, since that is what actually selects the
    // sentinel. decimal(38,9) against decimal(10,2) generates identical SQL.
    if (normalizeType(listedType) !== normalizeType(column.type)) {
      typeMismatches.push({ name, listed: listedType, actual: column.type });
      continue;
    }

    matched++;
  }

  const uncovered = schema
    .filter((column) => !seen.has(column.name.trim().toLowerCase()))
    .map((column) => column.name);

  return {
    unknown,
    typeMismatches,
    uncovered,
    matched,
    clean: unknown.length === 0 && typeMismatches.length === 0,
  };
}
