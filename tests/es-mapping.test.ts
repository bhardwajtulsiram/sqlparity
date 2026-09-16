import { describe, it, expect } from 'vitest';
import {
  diffEsFields,
  diffEsSettings,
  looksLikeEsMapping,
  parseEsMapping,
  stableJson,
  summarise,
  type EsField,
} from '../lib/es-mapping';

/** What you send to create an index. */
const SENT = JSON.stringify({
  mappings: {
    properties: {
      customer_id: { type: 'keyword', normalizer: 'lowercase_normalizer' },
      company_name: { type: 'keyword', normalizer: 'lowercase_normalizer', index: false },
      created_at: { type: 'date', format: 'date' },
      employee_count: { type: 'long' },
    },
  },
  settings: { index: { number_of_shards: '4', number_of_replicas: '0' } },
});

/** What the cluster reports back: wrapped in the index name, keys reordered, extras added. */
const REPORTED = JSON.stringify({
  orders_index: {
    aliases: {},
    mappings: {
      properties: {
        // Same content, different key order — this must not read as a change.
        customer_id: { normalizer: 'lowercase_normalizer', type: 'keyword' },
        company_name: { index: false, type: 'keyword', normalizer: 'lowercase_normalizer' },
        created_at: { format: 'date', type: 'date' },
        employee_count: { type: 'long' },
      },
    },
    settings: {
      index: {
        number_of_shards: '4',
        number_of_replicas: '0',
        uuid: 'abc123',
        creation_date: '1789530643110',
        provided_name: 'orders_index',
        version: { created: '8505000' },
      },
    },
  },
});

const fieldsOf = (json: string): EsField[] => {
  const result = parseEsMapping(json);
  if (!result.mapping) throw new Error(result.error);
  return result.mapping.fields;
};

describe('recognising an index mapping', () => {
  it('spots the shape you send and the shape you get back', () => {
    expect(looksLikeEsMapping(SENT)).toBe(true);
    expect(looksLikeEsMapping(REPORTED)).toBe(true);
  });

  it('does not claim SQL', () => {
    expect(looksLikeEsMapping('CREATE TABLE t (id INT)')).toBe(false);
    expect(looksLikeEsMapping('')).toBe(false);
  });

  it('does not claim unrelated JSON', () => {
    expect(looksLikeEsMapping('{"hello":"world"}')).toBe(false);
  });
});

describe('parsing', () => {
  it('reads the mapping you send', () => {
    const result = parseEsMapping(SENT);
    expect(result.error).toBeUndefined();
    expect(result.mapping?.fields.map((f) => f.name)).toEqual([
      'customer_id',
      'company_name',
      'created_at',
      'employee_count',
    ]);
    expect(result.mapping?.index).toBeUndefined();
  });

  it('unwraps the index name from a GET response', () => {
    const result = parseEsMapping(REPORTED);
    expect(result.mapping?.index).toBe('orders_index');
    expect(result.mapping?.fields).toHaveLength(4);
  });

  it('accepts a bare properties block', () => {
    const result = parseEsMapping('{"properties":{"a":{"type":"keyword"}}}');
    expect(result.mapping?.fields).toEqual([{ name: 'a', type: 'keyword', attributes: {} }]);
  });

  it('keeps type apart from the rest of the definition', () => {
    const [field] = fieldsOf('{"properties":{"a":{"type":"keyword","index":false}}}');
    expect(field.type).toBe('keyword');
    expect(field.attributes).toEqual({ index: false });
  });

  it('flattens a nested object to dotted names, keeping the parent', () => {
    const fields = fieldsOf(
      '{"properties":{"address":{"properties":{"city":{"type":"text"}}}}}',
    );
    expect(fields.map((f) => `${f.name}:${f.type}`)).toEqual(['address:object', 'address.city:text']);
  });

  it('records a multi-field under the name you would query it by', () => {
    const fields = fieldsOf(
      '{"properties":{"title":{"type":"text","fields":{"raw":{"type":"keyword"}}}}}',
    );
    expect(fields.map((f) => f.name)).toEqual(['title', 'title.raw']);
  });

  it('flattens settings to dotted keys', () => {
    const result = parseEsMapping(SENT);
    expect(result.mapping?.settings['index.number_of_shards']).toBe('4');
  });

  it('explains bad JSON rather than throwing', () => {
    expect(parseEsMapping('{not json').error).toContain('not valid JSON');
  });

  it('refuses a document holding several indexes', () => {
    const result = parseEsMapping('{"a":{"mappings":{}},"b":{"mappings":{}}}');
    expect(result.error).toContain('found 2');
  });

  it('says so when there are no fields', () => {
    expect(parseEsMapping('{"mappings":{"properties":{}}}').error).toContain('no fields');
  });
});

describe('comparing two mappings', () => {
  it('reports no differences when only key order and index name differ', () => {
    // The whole point: the document you sent and the one the cluster returns are not
    // textually equal even when the index is exactly what you asked for.
    const changes = diffEsFields(fieldsOf(SENT), fieldsOf(REPORTED));
    expect(summarise(changes)).toEqual({
      added: 0,
      removed: 0,
      retyped: 0,
      attributes: 0,
      unchanged: 4,
      total: 4,
    });
  });

  it('finds a field that never arrived', () => {
    const after = fieldsOf(REPORTED).filter((f) => f.name !== 'created_at');
    const changes = diffEsFields(fieldsOf(SENT), after);
    expect(changes.find((c) => c.name === 'created_at')).toMatchObject({
      kind: 'removed',
      before: 'date',
    });
  });

  it('finds a field that appeared unasked for', () => {
    const after = [...fieldsOf(REPORTED), { name: 'extra', type: 'text', attributes: {} }];
    const changes = diffEsFields(fieldsOf(SENT), after);
    expect(changes.find((c) => c.name === 'extra')).toMatchObject({ kind: 'added', after: 'text' });
  });

  it('finds a type that came back different', () => {
    const after = fieldsOf(REPORTED).map((f) =>
      f.name === 'employee_count' ? { ...f, type: 'keyword' } : f,
    );
    const changes = diffEsFields(fieldsOf(SENT), after);
    expect(changes.find((c) => c.name === 'employee_count')).toMatchObject({
      kind: 'retyped',
      before: 'long',
      after: 'keyword',
    });
  });

  it('finds a field whose type is right but configuration is not', () => {
    // The dangerous one: right type, silently unsearchable because the normalizer
    // never made it across.
    const after = fieldsOf(REPORTED).map((f) =>
      f.name === 'customer_id' ? { ...f, attributes: {} } : f,
    );
    const change = diffEsFields(fieldsOf(SENT), after).find((c) => c.name === 'customer_id');
    expect(change?.kind).toBe('attributes');
    expect(change?.attributes).toEqual([
      { key: 'normalizer', before: '"lowercase_normalizer"', after: undefined },
    ]);
  });

  it('treats field names as case-sensitive, because Elasticsearch does', () => {
    const changes = diffEsFields(
      [{ name: 'Name', type: 'keyword', attributes: {} }],
      [{ name: 'name', type: 'keyword', attributes: {} }],
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(['added', 'removed']);
  });
});

describe('comparing settings', () => {
  it('ignores nothing but marks what the cluster wrote itself', () => {
    const a = parseEsMapping(SENT).mapping!.settings;
    const b = parseEsMapping(REPORTED).mapping!.settings;
    const changes = diffEsSettings(a, b);

    expect(changes.every((c) => c.generated)).toBe(true);
    expect(changes.map((c) => c.key).sort()).toEqual([
      'index.creation_date',
      'index.provided_name',
      'index.uuid',
      'index.version.created',
    ]);
  });

  it('reports a setting that genuinely differs', () => {
    const changes = diffEsSettings(
      { 'index.number_of_shards': '4' },
      { 'index.number_of_shards': '1' },
    );
    expect(changes).toEqual([
      { key: 'index.number_of_shards', before: '4', after: '1', generated: false },
    ]);
  });

  it('says nothing when the settings match', () => {
    expect(diffEsSettings({ a: '1' }, { a: '1' })).toEqual([]);
  });
});

describe('stable comparison of values', () => {
  it('sorts object keys so order never reads as a difference', () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
  });

  it('keeps array order, which does carry meaning', () => {
    expect(stableJson(['a', 'b'])).not.toBe(stableJson(['b', 'a']));
  });
});
