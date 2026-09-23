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
 * So both shapes are accepted, and everything the cluster does to a request on the
 * way in is undone before comparing, because each of those would otherwise read as a
 * difference in an index that is exactly what was asked for:
 *
 *   - it does not preserve the order of keys inside a field definition;
 *   - it files every setting under `index.`, so `number_of_shards` comes back as
 *     `index.number_of_shards`;
 *   - it leaves out any parameter set to its default value when it reports a mapping;
 *   - it expands a dotted field name (`"geo.country"`) into an object holding a field;
 *   - it returns setting values as strings, so `5` comes back as `"5"`;
 *   - and it writes a handful of settings of its own — the uuid, the creation date.
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
  /** Present when the document names the index: the GET response, or a `PUT index` line. */
  index?: string;
  fields: EsField[];
  /**
   * Index settings flattened to dotted keys under `index.`, plus the mapping's own
   * top-level parameters (`dynamic`, `_source`, …) under `mappings.`. Both describe how
   * the index behaves rather than any one field, so they are compared the same way.
   */
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
 * They cannot appear in the mapping you sent, so comparing them would report them as
 * differences on every single check and train you to ignore the list.
 * `_tier_preference` is set on every index since 7.10 unless you set it yourself.
 */
export const GENERATED_SETTINGS = [
  'index.uuid',
  'index.creation_date',
  'index.provided_name',
  'index.version.created',
  'index.version.upgraded',
  'index.routing.allocation.include._tier_preference',
];

/**
 * Mapping-level parameters, and the value each has when it is not set. A mapping that
 * leaves `dynamic` out behaves exactly like one that says `"dynamic": true`.
 */
const MAPPING_PARAMETERS: Record<string, string | undefined> = {
  dynamic: 'true',
  date_detection: 'true',
  numeric_detection: 'false',
  subobjects: 'true',
  dynamic_templates: undefined,
  dynamic_date_formats: undefined,
  _source: undefined,
  _routing: undefined,
  _meta: undefined,
  _field_names: undefined,
  runtime: undefined,
};

/**
 * Field parameters and their defaults, per type. Elasticsearch leaves a parameter out
 * of the mapping it reports when it holds its default, so `"index": true` sent and
 * nothing returned is not a difference. Only defaults that hold for every version
 * since 7.x are listed; anything unlisted is compared as written.
 */
const COMMON_DEFAULTS: Record<string, unknown> = {
  index: true,
  doc_values: true,
  store: false,
  boost: 1,
  coerce: true,
  ignore_malformed: false,
  eager_global_ordinals: false,
  similarity: 'BM25',
  copy_to: [],
  meta: {},
};

const TYPE_DEFAULTS: Record<string, Record<string, unknown>> = {
  text: {
    norms: true,
    index_options: 'positions',
    fielddata: false,
    position_increment_gap: 100,
    term_vector: 'no',
    analyzer: 'default',
  },
  keyword: {
    norms: false,
    index_options: 'docs',
    split_queries_on_whitespace: false,
    ignore_above: 2147483647,
  },
  date: { format: 'strict_date_optional_time||epoch_millis' },
  date_nanos: { format: 'strict_date_optional_time_nanos||epoch_millis' },
  object: { enabled: true },
  nested: { enabled: true, include_in_parent: false, include_in_root: false },
};

/** Cheap check for routing a pasted document to this parser rather than the SQL one. */
export function looksLikeEsMapping(text: string): boolean {
  const trimmed = stripConsoleSyntax(text).text.trim();
  if (!trimmed.startsWith('{')) return false;
  return /"(mappings|properties)"\s*:/.test(trimmed);
}

/**
 * Undo what Kibana's Dev Tools console adds around a request body.
 *
 * Copying a request out of the console gives `PUT my_index` on the first line and may
 * carry `//` or `#` comments, none of which is JSON. Each is overwritten with spaces
 * rather than removed, so every line keeps its number and the line references in the
 * comparison still point at the right place.
 */
export function stripConsoleSyntax(text: string): { text: string; index?: string } {
  let out = '';
  let index: string | undefined;

  const request = /^(\s*)(PUT|POST|GET)\s+\/?([^\s/?{]+)[^\n]*/i.exec(text);
  let i = 0;
  if (request) {
    const name = request[3]!;
    if (!name.startsWith('_')) index = decodeURIComponent(name);
    out = request[1]! + ' '.repeat(request[0].length - request[1]!.length);
    i = request[0].length;
  }

  let inString = false;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[++i];
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if ((ch === '/' && text[i + 1] === '/') || ch === '#') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      if (i < text.length) out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end - 1;
      continue;
    }
    out += ch;
  }
  return { text: out, index };
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

/**
 * A value as Elasticsearch understands it, for comparison only.
 *
 * It accepts `"false"` for `false` and `"256"` for `256`, and stores a single
 * `copy_to` target as a list of one — so those spellings mean the same thing.
 */
function normalized(key: string, value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (key === 'copy_to' && typeof value === 'string') return [value];
  return value;
}

/** Flatten nested settings into dotted keys. Arrays are kept whole as text. */
function flattenSettings(
  value: unknown,
  prefix: string,
  into: Record<string, { value: string; path: string }>,
  path: string,
) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenSettings(child, prefix ? `${prefix}.${key}` : key, into, path ? `${path}.${key}` : key);
    }
    return into;
  }
  if (prefix) into[prefix] = { value: Array.isArray(value) ? stableJson(value) : String(value), path };
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
 *
 * A dotted name like `"geo.country"` is filed the way Elasticsearch files it: as the
 * field `country` inside an object `geo`. Otherwise the request, which says
 * `geo.country`, and the cluster's answer, which says `geo` holding `country`, would
 * disagree about a field that exists on both.
 */
function collectFields(
  properties: Record<string, unknown>,
  prefix: string,
  into: Map<string, EsField>,
  /** Where this block sits in the raw document, for looking the line up. */
  jsonPath: string,
  lines: Map<string, number>,
): void {
  for (const [name, raw] of Object.entries(properties)) {
    if (raw === null || typeof raw !== 'object') continue;
    const definition = raw as Record<string, unknown>;
    const here = jsonPath ? `${jsonPath}.${name}` : name;
    const line = lines.get(here);

    // Objects implied by a dotted name, created unless the mapping declares them.
    const parts = name.split('.').filter(Boolean);
    let path = prefix;
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}.${part}` : part;
      if (!into.has(path)) into.set(path, { name: path, type: 'object', attributes: {}, line });
    }
    path = path ? `${path}.${parts[parts.length - 1] ?? name}` : (parts[parts.length - 1] ?? name);

    const nested = definition.properties as Record<string, unknown> | undefined;
    const multi = definition.fields as Record<string, unknown> | undefined;

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(definition)) {
      if (key === 'type' || key === 'properties' || key === 'fields') continue;
      attributes[key] = value;
    }

    into.set(path, {
      name: path,
      // A block with children and no declared type is an object mapping.
      type: typeof definition.type === 'string' ? definition.type : nested ? 'object' : 'unknown',
      attributes,
      line,
    });

    if (nested) collectFields(nested, path, into, `${here}.properties`, lines);
    if (multi) collectFields(multi, path, into, `${here}.fields`, lines);
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseEsMapping(text: string): EsParseResult {
  const cleaned = stripConsoleSyntax(text);
  // Not trimmed: the text is also what line numbers are counted in, and dropping a
  // leading blank line would shift every one of them.
  const source = cleaned.text;
  if (source.trim() === '') return { error: 'Nothing to read.' };

  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch (error) {
    return { error: `That is not valid JSON — ${error instanceof Error ? error.message : error}` };
  }
  if (!isObject(document)) {
    return { error: 'Expected a JSON object holding an index mapping.' };
  }

  let body: Json = document;
  let index: string | undefined = cleaned.index;
  /** Prefix of the raw document we have descended through, for the line lookup. */
  let jsonPrefix = '';
  const descend = (key: string) => {
    body = body[key] as Json;
    jsonPrefix = jsonPrefix ? `${jsonPrefix}.${key}` : key;
  };

  // GET _index_template returns a list; a single template in it is unwrapped.
  if (Array.isArray(body.index_templates)) {
    const templates = body.index_templates as Json[];
    if (templates.length !== 1) {
      return { error: `Expected one index template, found ${templates.length}. Paste a single one.` };
    }
    const only = templates[0]!;
    index = typeof only.name === 'string' ? only.name : index;
    body = { index_template: only.index_template } as Json;
    jsonPrefix = 'index_templates.0';
    descend('index_template');
  }

  // A composable index template keeps its mapping under `template`.
  if (isObject(body.template) && (body.template.mappings || body.template.settings)) {
    descend('template');
  }

  // The GET-index response wraps everything in the index name.
  if (!('mappings' in body) && !('properties' in body) && !('settings' in body)) {
    const names = Object.keys(body);
    if (names.length !== 1) {
      return {
        error:
          names.length === 0
            ? 'That object is empty.'
            : `Expected one index, found ${names.length} (${names.slice(0, 4).join(', ')}). Paste a single index, or the mapping on its own.`,
      };
    }
    index = names[0];
    if (!isObject(body[index!])) {
      return { error: `"${index}" does not hold an index definition.` };
    }
    descend(index!);
  }

  const hasMappings = body.mappings !== undefined;
  let mappings = (body.mappings ?? body) as Json;
  let mappingsPath = hasMappings ? (jsonPrefix ? `${jsonPrefix}.mappings` : 'mappings') : jsonPrefix;
  const settingsBase = jsonPrefix;

  // Before 7.0 a mapping sat under a type name: { "mappings": { "_doc": { "properties": … } } }.
  if (!isObject(mappings.properties)) {
    const typeNames = Object.keys(mappings).filter(
      (k) => isObject(mappings[k]) && isObject((mappings[k] as Json).properties),
    );
    if (typeNames.length === 1 && !(typeNames[0]! in MAPPING_PARAMETERS)) {
      mappingsPath = mappingsPath ? `${mappingsPath}.${typeNames[0]}` : typeNames[0]!;
      mappings = mappings[typeNames[0]!] as Json;
    }
  }

  const properties = (mappings.properties ?? {}) as Json;
  if (!isObject(properties)) {
    return { error: 'Found no "properties" block, so there are no fields to compare.' };
  }

  const lines = keyLines(source);
  const collected = new Map<string, EsField>();
  collectFields(
    properties,
    '',
    collected,
    mappingsPath ? `${mappingsPath}.properties` : 'properties',
    lines,
  );
  const fields = [...collected.values()];
  if (fields.length === 0) {
    return { error: 'The "properties" block is empty, so there are no fields to compare.' };
  }

  // Settings, filed under `index.` the way the cluster files them.
  const settings: Record<string, string> = {};
  const settingLines: Record<string, number> = {};
  const rawSettings = flattenSettings(
    body.settings ?? {},
    '',
    {},
    settingsBase ? `${settingsBase}.settings` : 'settings',
  );
  for (const [key, { value, path }] of Object.entries(rawSettings)) {
    const filed = key.startsWith('index.') ? key : `index.${key}`;
    settings[filed] = value;
    const line = lines.get(path);
    if (line !== undefined) settingLines[filed] = line;
  }

  // The mapping's own parameters, compared alongside the settings.
  for (const [key, fallback] of Object.entries(MAPPING_PARAMETERS)) {
    const value = mappings[key];
    if (value === undefined) {
      if (fallback !== undefined) settings[`mappings.${key}`] = fallback;
      continue;
    }
    settings[`mappings.${key}`] = isObject(value) || Array.isArray(value) ? stableJson(value) : String(value);
    const line = lines.get(mappingsPath ? `${mappingsPath}.${key}` : key);
    if (line !== undefined) settingLines[`mappings.${key}`] = line;
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

/** The default for one parameter on one type, or undefined when it has none listed. */
function defaultFor(type: string, key: string): unknown {
  const specific = TYPE_DEFAULTS[type];
  if (specific && key in specific) return specific[key];
  if (key in COMMON_DEFAULTS) {
    // text fields have no doc values at all, so there is no default to fall back on.
    if (type === 'text' && key === 'doc_values') return undefined;
    return COMMON_DEFAULTS[key];
  }
  return undefined;
}

/** Which attributes differ between two field definitions, ignoring key order and defaults. */
function attributeDiff(
  type: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): EsAttributeChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changes: EsAttributeChange[] = [];

  for (const key of keys) {
    const has = (o: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(o, key);
    const fallback = defaultFor(type, key);
    const value = (o: Record<string, unknown>) =>
      has(o) ? normalized(key, o[key]) : fallback;
    const a = value(before);
    const b = value(after);
    if (stableJson(a) === stableJson(b)) continue;
    changes.push({
      key,
      before: has(before) ? stableJson(before[key]) : undefined,
      after: has(after) ? stableJson(after[key]) : undefined,
    });
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
    const attributes = attributeDiff(field.type, field.attributes, match.attributes);
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
