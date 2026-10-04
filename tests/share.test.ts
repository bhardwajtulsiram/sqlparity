import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodeShareState, encodeShareState } from '../lib/share';

describe('Zero-server state sharing via URL hash', () => {
  it('encodes and decodes an object roundtrip', () => {
    const input = {
      sql: 'SELECT id, first_name, last_name, email FROM users WHERE active = true ORDER BY created_at DESC;',
      dialect: 'postgresql',
      targetDialect: 'snowflake',
    };

    const hash = encodeShareState(input);
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
    // URL safe characters only
    expect(hash).not.toMatch(/[+/=]/);

    const decoded = decodeShareState<typeof input>(`#share=${hash}`);
    expect(decoded).toEqual(input);
  });

  it('handles raw hash payload without #share= prefix', () => {
    const input = { template: 'SELECT * FROM {col}', fields: 'id\nname' };
    const hash = encodeShareState(input);
    const decoded = decodeShareState<typeof input>(hash);
    expect(decoded).toEqual(input);
  });

  it('returns null on invalid or corrupted payload', () => {
    expect(decodeShareState('')).toBeNull();
    expect(decodeShareState('#share=invalid_payload!@#$')).toBeNull();
    expect(decodeShareState('not-valid-base64')).toBeNull();
  });

  it('builds a share URL with the given pathname', () => {
    const input = { dialect: 'mysql' };
    const url = buildShareUrl(input, '/sql-formatter/');
    expect(url).toContain('/sql-formatter/#share=');
  });
});
