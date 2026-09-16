import { describe, it, expect } from 'vitest';
import { keyLines } from '../lib/json-lines';

const DOC = `{
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

describe('finding the line a JSON key sits on', () => {
  it('reports the line for a key at any depth', () => {
    const lines = keyLines(DOC);
    expect(lines.get('mappings')).toBe(2);
    expect(lines.get('mappings.properties.customer_id')).toBe(4);
    expect(lines.get('mappings.properties.address')).toBe(5);
    expect(lines.get('mappings.properties.address.properties.city')).toBe(7);
  });

  it('handles several keys sharing one line', () => {
    expect(keyLines(DOC).get('settings.index.number_of_shards')).toBe(12);
  });

  it('only treats a string as a key when a colon follows', () => {
    // "keyword" is a value, not a key, and must not get a path of its own.
    const lines = keyLines('{"a":"keyword"}');
    expect(lines.has('a')).toBe(true);
    expect(lines.has('a.keyword')).toBe(false);
    expect(lines.has('keyword')).toBe(false);
  });

  it('does not let an escaped quote end a string early', () => {
    const lines = keyLines('{\n  "a\\"b": 1,\n  "c": 2\n}');
    expect(lines.get('c')).toBe(3);
  });

  it('counts lines inside a multi-line document from one', () => {
    expect(keyLines('{"a":1}').get('a')).toBe(1);
  });

  it('gives nothing for an empty document rather than throwing', () => {
    expect(keyLines('').size).toBe(0);
    expect(keyLines('   ').size).toBe(0);
  });

  it('does not stall on malformed input', () => {
    // Validity is JSON.parse's job; this must simply terminate.
    expect(() => keyLines('{"a": {"b": ')).not.toThrow();
    expect(() => keyLines('{"unterminated')).not.toThrow();
  });

  it('keeps the first of a repeated key', () => {
    expect(keyLines('{\n"a":1,\n"a":2\n}').get('a')).toBe(2);
  });
});
