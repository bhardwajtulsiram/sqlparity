/**
 * Elasticsearch index schemas: parsing, and comparing one against another.
 *
 * The job this exists for is checking that an index was created the way it was asked
 * for. That means comparing the mapping you sent against the mapping the cluster
 * reports back, and those two are never quite the same document:
 *
 *   what you send   { "mappings": { "properties": { … } }, "settings": { … } }
 *   what you get    { "my_index": { "aliases": {}, "mappings": { … }, "settings": { … } } }
 *
 * So both shapes are accepted. Two other things would otherwise produce differences
 * that are not differences: Elasticsearch does not preserve the order of keys inside
 * a field definition, and it adds four settings of its own on creation. Reporting
 * either as a change would bury the real ones.
 */

import { keyLines } from './json-lines';

export interface EsField {
  /** Dotted path, so a nested field reads `address.city`. */
  name: string;
  /** The declared type. `object` when a field only holds other fields. */
  type: string;
  /** Everything else on the field — normalizer, index, doc_values, format, and so on. */
  attributes: Record<string, unknown>;
  /** 1-based line in the pasted document, so a difference can point at it. */
  line?: number;
}

export interface EsMapping {
  /** Present only when the document was the GET-index response, which names it. */
  index?: string;
  fields: EsField[];
  /** Settings flattened to dotted keys, so `index.number_of_shards`. */
  settings: Record<string, string>;
  /** Line of each setting in the pasted document, keyed the same way. */
  settingLines: Record<string, number>;
}

export interface EsParseResult {
  mapping?: EsMapping;
  error?: string;
}

/**
 * Settings Elasticsearch writes itself when it creates the index.
 *
 * They cannot appear in the mapping you sent, so comparing them would report four
 * differences on every single check and train you to ignore the list.
 */
export const GENERATED_SETTINGS = [
  'index.uuid',
  'index.creation_date',
  'index.provided_name',
  'index.version.created',
  'index.version.upgraded',
];

/** Cheap check for routing a pasted document to this parser rather than the SQL one. */
export function looksLikeEsMapping(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  return /"(mappings|properties)"\s*:/.test(trimmed);
}

/** Stable text for a value, so key order inside an attribute never reads as a change. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** Flatten nested settings into dotted keys. Arrays are kept whole as text. */
function flattenSettings(value: unknown, prefix = '', into: Record<string, string> = {}) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenSettings(child, prefix ? `${prefix}.${key}` : key, into);
    }
    return into;
  }
  if (prefix) into[prefix] = Array.isArray(value) ? stableJson(value) : String(value);
  return into;
}

/**
 * Walk a `properties` block into a flat field list.
 *
 * A field holding other fields is recorded in its own right as well as its children:
 * losing `address` entirely would hide the case where one side has it as an object and
 * the other as a flattened string. Multi-fields — the `fields` block that lets one
 * value be both `text` and `keyword` — are recorded under the dotted sub-name, because
 * that is how you query them.
 */
function collectFields(
  properties: Record<string, unknown>,
  prefix: string,
  into: EsField[],
  /** Where this block sits in the raw document, for looking the line up. */
  jsonPath: string,
  lines: Map<string, number>,
): void {
  for (const [name, raw] of Object.entries(properties)) {
    if (raw === null || typeof raw !== 'object') continue;
    const definition = raw as Record<string, unknown>;
    const path = prefix ? `${prefix}.${name}` : name;
    const here = jsonPath ? `${jsonPath}.${name}` : name;

    const nested = definition.properties as Record<string, unknown> | undefined;
    const multi = definition.fields as Record<string, unknown> | undefined;

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(definition)) {
      if (key === 'type' || key === 'properties' || key === 'fields') continue;
      attributes[key] = value;
    }

    into.push({
      name: path,
      // A block with children and no declared type is an object mapping.
      type: typeof definition.type === 'string' ? definition.type : nested ? 'object' : 'unknown',
      attributes,
      line: lines.get(here),
    });

    if (nested) collectFields(nested, path, into, `${here}.properties`, lines);
    if (multi) collectFields(multi, path, into, `${here}.fields`, lines);
  }
}

export function parseEsMapping(text: string): EsParseResult {
  const trimmed = text.trim();
  if (trimmed === '') return { error: 'Nothing to read.' };

  let document: unknown;
  try {
    document = JSON.parse(trimmed);
  } catch (error) {
    return { error: `That is not valid JSON — ${error instanceof Error ? error.message : error}` };
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { error: 'Expected a JSON object holding an index mapping.' };
  }

  let body = document as Record<string, unknown>;
  let index: string | undefined;
  /** Prefix of the raw document we have descended through, for the line lookup. */
  let jsonPrefix = '';

  // The GET-index response wraps everything in the index name.
  if (!('mappings' in body) && !('properties' in body) && !('settings' in body)) {
    const names = Object.keys(body);
    if (names.length !== 1) {
      return {
        error:
          names.length === 0
            ? 'That object is empty.'
            : `Expected one index, found ${names.length}. Paste a single index, or the mapping on its own.`,
      };
    }
    index = names[0];
    jsonPrefix = index;
    const inner = body[index];
    if (inner === null || typeof inner !== 'object') {
      return { error: `"${index}" does not hold an index definition.` };
    }
    body = inner as Record<string, unknown>;
  }

  const hasMappings = body.mappings !== undefined;
  const mappings = (body.mappings ?? body) as Record<string, unknown>;
  if (hasMappings) jsonPrefix = jsonPrefix ? `${jsonPrefix}.mappings` : 'mappings';
  const properties = (mappings.properties ?? {}) as Record<string, unknown>;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    return { error: 'Found no "properties" block, so there are no fields to compare.' };
  }

  const lines = keyLines(trimmed);
  const fields: EsField[] = [];
  collectFields(
    properties,
    '',
    fields,
    jsonPrefix ? `${jsonPrefix}.properties` : 'properties',
    lines,
  );
  if (fields.length === 0) {
    return { error: 'The "properties" block is empty, so there are no fields to compare.' };
  }

  const settings = flattenSettings(body.settings ?? {});
  // The settings block is a sibling of mappings, not a child of it.
  // Optional dot: the bare shape gives a prefix of exactly 'mappings', the wrapped
  // one 'index_name.mappings'. Both need it gone.
  const settingsPrefix = jsonPrefix.replace(/\.?mappings$/, '');
  const settingLines: Record<string, number> = {};
  for (const key of Object.keys(settings)) {
    const full = settingsPrefix ? `${settingsPrefix}.settings.${key}` : `settings.${key}`;
    const line = lines.get(full);
    if (line !== undefined) settingLines[key] = line;
  }

  return { mapping: { index, fields, settings, settingLines } };
}

/* -------------------------------------------------------------------- diff */

export type EsChangeKind = 'added' | 'removed' | 'retyped' | 'attributes' | 'unchanged';

export interface EsAttributeChange {
  key: string;
  /** Absent where the side did not declare the attribute at all. */
  before?: string;
  after?: string;
}

export interface EsFieldChange {
  name: string;
  kind: EsChangeKind;
  before?: string;
  after?: string;
  /** Set when the type matches but the field is configured differently. */
  attributes?: EsAttributeChange[];
  /** Line in each pasted document, so the difference can be pointed at. */
  beforeLine?: number;
  afterLine?: number;
}

/** Which attributes differ between two field definitions, ignoring key order. */
function attributeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): EsAttributeChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: EsAttributeChange[] = [];

  for (const key of keys) {
    const has = (o: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(o, key);
    const a = has(before) ? stableJson(before[key]) : undefined;
    const b = has(after) ? stableJson(after[key]) : undefined;
    if (a !== b) changes.push({ key, before: a, after: b });
  }
  return changes;
}

/**
 * Compare two mappings field by field.
 *
 * Field names are matched case-sensitively, unlike the SQL diff: Elasticsearch field
 * names are case-sensitive, so `Name` and `name` really are two different fields and
 * folding them together would hide a genuine mismatch.
 */
export function diffEsFields(before: EsField[], after: EsField[]): EsFieldChange[] {
  const beforeMap = new Map(before.map((f) => [f.name, f]));
  const afterMap = new Map(after.map((f) => [f.name, f]));
  const changes: EsFieldChange[] = [];

  for (const field of before) {
    const match = afterMap.get(field.name);
    if (!match) {
      changes.push({
        name: field.name,
        kind: 'removed',
        before: field.type,
        beforeLine: field.line,
      });
      continue;
    }
    if (match.type !== field.type) {
      changes.push({
        name: field.name,
        kind: 'retyped',
        before: field.type,
        after: match.type,
        beforeLine: field.line,
        afterLine: match.line,
      });
      continue;
    }
    const attributes = attributeDiff(field.attributes, match.attributes);
    changes.push({
      name: field.name,
      kind: attributes.length > 0 ? 'attributes' : 'unchanged',
      before: field.type,
      after: match.type,
      beforeLine: field.line,
      afterLine: match.line,
      ...(attributes.length > 0 ? { attributes } : {}),
    });
  }

  for (const field of after) {
    if (!beforeMap.has(field.name)) {
      changes.push({
        name: field.name,
        kind: 'added',
        after: field.type,
        afterLine: field.line,
      });
    }
  }

  return changes;
}

export interface EsSettingChange {
  key: string;
  before?: string;
  after?: string;
  beforeLine?: number;
  afterLine?: number;
  /** True for the keys Elasticsearch writes itself, which are shown but never counted. */
  generated: boolean;
}

/** Compare index settings, marking the ones the cluster generates rather than hiding them. */
export function diffEsSettings(
  before: Record<string, string>,
  after: Record<string, string>,
  beforeLines: Record<string, number> = {},
  afterLines: Record<string, number> = {},
): EsSettingChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: EsSettingChange[] = [];

  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (a === b) continue;
    changes.push({
      key,
      before: a,
      after: b,
      beforeLine: beforeLines[key],
      afterLine: afterLines[key],
      // Prefix match so index.version.created and anything else under it is covered.
      generated: GENERATED_SETTINGS.some((g) => key === g || key.startsWith(`${g}.`)),
    });
  }
  return changes;
}

/** Counts for the summary line, so the real differences are not buried in the total. */
export function summarise(changes: EsFieldChange[]) {
  const count = (kind: EsChangeKind) => changes.filter((c) => c.kind === kind).length;
  return {
    added: count('added'),
    removed: count('removed'),
    retyped: count('retyped'),
    attributes: count('attributes'),
    unchanged: count('unchanged'),
    total: changes.length,
  };
}
