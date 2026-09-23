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
    expect(result.mapping?.fields).toEqual([
      { name: 'a', type: 'keyword', attributes: {}, line: 1 },
    ]);
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

describe('line numbers', () => {
  const SENT_LINES = `{
  "mappings": {
    "properties": {
      "customer_id": { "type": "keyword" },
      "address": {
        "properties": {
          "city": { "type": "text" }
        }
      }
    }
  },
  "settings": { "index": { "number_of_shards": "4" } }
}`;

  const GOT_LINES = `{
  "orders_index": {
    "mappings": {
      "properties": {
        "customer_id": { "type": "long" },
        "address": {
          "properties": {
            "city": { "type": "text" }
          }
        }
      }
    },
    "settings": { "index": { "number_of_shards": "8" } }
  }
}`;

  it('records the line each field was declared on', () => {
    const mapping = parseEsMapping(SENT_LINES).mapping!;
    expect(mapping.fields.map((f) => `${f.name}@${f.line}`)).toEqual([
      'customer_id@4',
      'address@5',
      'address.city@7',
    ]);
  });

  it('records lines through the index wrapper too', () => {
    const mapping = parseEsMapping(GOT_LINES).mapping!;
    expect(mapping.fields.map((f) => `${f.name}@${f.line}`)).toEqual([
      'customer_id@5',
      'address@6',
      'address.city@8',
    ]);
  });

  it('records setting lines in both shapes', () => {
    // The unwrapped document has settings at the root; the wrapped one under the
    // index name. Both must resolve.
    expect(parseEsMapping(SENT_LINES).mapping!.settingLines['index.number_of_shards']).toBe(12);
    expect(parseEsMapping(GOT_LINES).mapping!.settingLines['index.number_of_shards']).toBe(13);
  });

  it('carries both lines onto a difference', () => {
    const a = parseEsMapping(SENT_LINES).mapping!;
    const b = parseEsMapping(GOT_LINES).mapping!;
    const change = diffEsFields(a.fields, b.fields).find((c) => c.name === 'customer_id');
    expect(change).toMatchObject({ kind: 'retyped', beforeLine: 4, afterLine: 5 });
  });

  it('carries lines onto a setting difference', () => {
    const a = parseEsMapping(SENT_LINES).mapping!;
    const b = parseEsMapping(GOT_LINES).mapping!;
    const [change] = diffEsSettings(a.settings, b.settings, a.settingLines, b.settingLines);
    expect(change).toMatchObject({ beforeLine: 12, afterLine: 13 });
  });
});

/* ------------------------------------- a real request against the cluster's answer */

/** A create-index request written the usual way: no `index.` prefix, defaults spelled out. */
const REQUEST = {
  settings: {
    number_of_shards: 4,
    number_of_replicas: 0,
    analysis: {
      normalizer: { lowercase_normalizer: { type: 'custom', filter: ['lowercase'] } },
      filter: {
        phonetic_filter: { type: 'phonetic', encoder: 'double_metaphone', replace: false, max_code_len: 5 },
      },
      analyzer: { name_phonetic: { tokenizer: 'standard', filter: ['lowercase', 'phonetic_filter'] } },
    },
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      customer_id: { type: 'keyword', normalizer: 'lowercase_normalizer' },
      name: {
        type: 'text',
        analyzer: 'name_phonetic',
        fields: { raw: { type: 'keyword', ignore_above: 256 } },
      },
      created_at: { type: 'date', format: 'strict_date_optional_time||epoch_millis' },
      employee_count: { type: 'long', index: true, doc_values: true },
      address: { type: 'object', properties: { city: { type: 'keyword' } } },
      'geo.country': { type: 'keyword', copy_to: 'all_text' },
      contacts: { type: 'nested', properties: { email: { type: 'keyword' } } },
    },
  },
};

/** What an 8.x cluster reports for that request, when it was created exactly as asked. */
const ANSWER = {
  customers_v1: {
    aliases: {},
    mappings: {
      dynamic: 'strict',
      properties: {
        address: { properties: { city: { type: 'keyword' } } },
        contacts: { type: 'nested', properties: { email: { type: 'keyword' } } },
        created_at: { type: 'date' },
        customer_id: { type: 'keyword', normalizer: 'lowercase_normalizer' },
        employee_count: { type: 'long' },
        geo: { properties: { country: { type: 'keyword', copy_to: ['all_text'] } } },
        name: {
          type: 'text',
          analyzer: 'name_phonetic',
          fields: { raw: { type: 'keyword', ignore_above: 256 } },
        },
      },
    },
    settings: {
      index: {
        routing: { allocation: { include: { _tier_preference: 'data_content' } } },
        number_of_shards: '4',
        provided_name: 'customers_v1',
        creation_date: '1789530643110',
        analysis: {
          filter: {
            phonetic_filter: { max_code_len: '5', replace: 'false', type: 'phonetic', encoder: 'double_metaphone' },
          },
          normalizer: { lowercase_normalizer: { filter: ['lowercase'], type: 'custom' } },
          analyzer: { name_phonetic: { filter: ['lowercase', 'phonetic_filter'], tokenizer: 'standard' } },
        },
        number_of_replicas: '0',
        uuid: 'abc',
        version: { created: '8505000' },
      },
    },
  },
};

const realDifferences = (a: unknown, b: unknown) => {
  const x = parseEsMapping(typeof a === 'string' ? a : JSON.stringify(a, null, 2)).mapping!;
  const y = parseEsMapping(typeof b === 'string' ? b : JSON.stringify(b, null, 2)).mapping!;
  return {
    fields: diffEsFields(x.fields, y.fields).filter((c) => c.kind !== 'unchanged'),
    settings: diffEsSettings(x.settings, y.settings).filter((c) => !c.generated),
  };
};

describe('an index created exactly as requested', () => {
  it('shows no differences at all', () => {
    expect(realDifferences(REQUEST, ANSWER)).toEqual({ fields: [], settings: [] });
  });

  it('still reports a setting that really changed', () => {
    const changed = structuredClone(ANSWER);
    changed.customers_v1.settings.index.number_of_shards = '1';
    expect(realDifferences(REQUEST, changed).settings).toEqual([
      expect.objectContaining({ key: 'index.number_of_shards', before: '4', after: '1' }),
    ]);
  });

  it('reports dynamic mapping that was loosened', () => {
    const changed = structuredClone(ANSWER);
    changed.customers_v1.mappings.dynamic = 'true';
    expect(realDifferences(REQUEST, changed).settings).toEqual([
      expect.objectContaining({ key: 'mappings.dynamic', before: 'strict', after: 'true' }),
    ]);
  });

  it('reports _source excludes that were lost', () => {
    const request = structuredClone(REQUEST) as Record<string, any>;
    request.mappings._source = { excludes: ['secret'] };
    expect(realDifferences(request, ANSWER).settings.map((c) => c.key)).toEqual(['mappings._source']);
  });

  it('still reports a parameter that differs from its default', () => {
    const changed = structuredClone(ANSWER) as Record<string, any>;
    changed.customers_v1.mappings.properties.employee_count.index = false;
    expect(realDifferences(REQUEST, changed).fields).toEqual([
      expect.objectContaining({ name: 'employee_count', kind: 'attributes' }),
    ]);
  });

  it('treats _tier_preference as written by the cluster', () => {
    const x = parseEsMapping(JSON.stringify(REQUEST)).mapping!;
    const y = parseEsMapping(JSON.stringify(ANSWER)).mapping!;
    expect(
      diffEsSettings(x.settings, y.settings).find((c) => c.key.endsWith('_tier_preference'))?.generated,
    ).toBe(true);
  });
});

describe('documents as people copy them', () => {
  it('reads a Kibana Dev Tools request with its PUT line and comments', () => {
    const console = `PUT customers_v1\n{\n  // four primaries\n  "settings": { "number_of_shards": 4 },\n  "mappings": { "properties": { "a": { "type": "keyword" } } }\n}`;
    expect(looksLikeEsMapping(console)).toBe(true);
    const result = parseEsMapping(console);
    expect(result.error).toBeUndefined();
    expect(result.mapping?.index).toBe('customers_v1');
    expect(result.mapping?.fields[0]).toMatchObject({ name: 'a', line: 5 });
    expect(result.mapping?.settingLines['index.number_of_shards']).toBe(4);
  });

  it('does not mistake // inside a string for a comment', () => {
    const doc = '{"mappings":{"properties":{"url":{"type":"keyword","null_value":"http://x"}}}}';
    expect(parseEsMapping(doc).mapping?.fields[0]!.attributes.null_value).toBe('http://x');
  });

  it('reads an Elasticsearch 6 mapping with a type name', () => {
    const result = parseEsMapping(JSON.stringify({ mappings: { _doc: { properties: { a: { type: 'keyword' } } } } }));
    expect(result.mapping?.fields.map((f) => f.name)).toEqual(['a']);
  });

  it('reads a composable index template', () => {
    const template = { index_patterns: ['cust-*'], template: { mappings: { properties: { a: { type: 'keyword' } } } } };
    expect(parseEsMapping(JSON.stringify(template)).mapping?.fields.map((f) => f.name)).toEqual(['a']);
  });

  it('reads a GET _index_template response', () => {
    const response = {
      index_templates: [
        { name: 'cust', index_template: { index_patterns: ['cust-*'], template: { mappings: { properties: { a: { type: 'long' } } } } } },
      ],
    };
    const result = parseEsMapping(JSON.stringify(response));
    expect(result.mapping?.index).toBe('cust');
    expect(result.mapping?.fields[0]).toMatchObject({ name: 'a', type: 'long' });
  });

  it('names the indexes when a response holds several', () => {
    const doc = { a_v1: { mappings: { properties: {} } }, a_v2: { mappings: { properties: {} } } };
    expect(parseEsMapping(JSON.stringify(doc)).error).toContain('a_v1, a_v2');
  });
});
