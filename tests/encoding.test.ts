import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadTable } from '../lib/duckdb';
import { decodeLegacyText, isEncodingError } from '../lib/scratchpad';
import { openDuckDb, type NodeDuckDb } from './helpers/duckdb-node';

/**
 * Files that are not UTF-8: what Excel on Windows writes by default. The first
 * accented letter used to stop the load with DuckDB's "Invalid unicode" error.
 */

let db: NodeDuckDb;

beforeAll(async () => {
  db = await openDuckDb();
}, 60_000);

afterAll(() => db?.close());

/** Encode text as Windows-1252, byte for byte, the way a legacy tool would save it. */
function windows1252(text: string): Uint8Array {
  const special: Record<string, number> = { '€': 0x80, '’': 0x92, '“': 0x93, '”': 0x94 };
  return Uint8Array.from([...text].map((ch) => special[ch] ?? ch.charCodeAt(0)));
}

const COUNTRIES = [
  'name,french_name,alpha2,alpha3,numeric',
  "Afghanistan,Afghanistan (l'),AF,AFG,004",
  "Åland Islands,Åland(les Îles),AX,ALA,248",
  "Côte d'Ivoire,Côte d’Ivoire,CI,CIV,384",
  'Curaçao,Curaçao,CW,CUW,531',
];

async function load(name: string, bytes: Uint8Array) {
  await db.registerBytes(name, bytes);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = db.connection as any;
  const notes = await loadTable(conn, 'countries', name, 'csv', async () => {
    const { text, encoding } = decodeLegacyText(bytes);
    await db.registerBytes(`${name}.utf8`, new TextEncoder().encode(text));
    return { name: `${name}.utf8`, encoding };
  });
  const rows = (await db.query('SELECT name, french_name, numeric FROM countries ORDER BY numeric')).rows;
  return { notes, rows };
}

describe('CSV files that are not UTF-8', () => {
  it('recognises DuckDB\'s encoding error', () => {
    expect(isEncodingError('Invalid unicode (byte sequence mismatch) detected. This file is not utf-8 encoded.')).toBe(true);
    expect(isEncodingError('Could not convert string "N/A" to INTEGER')).toBe(false);
  });

  it('reads a Windows-1252 file with the accents intact, and says so', async () => {
    const { notes, rows } = await load('countries-1252.csv', windows1252(COUNTRIES.join('\r\n') + '\r\n'));
    expect(notes[0]).toContain('Windows-1252');
    expect(rows.map((r) => r[0])).toEqual(['Afghanistan', 'Åland Islands', "Côte d'Ivoire", 'Curaçao']);
    // Curly quote: Latin-1 would have turned 0x92 into a control character.
    expect(rows[2]![1]).toBe('Côte d’Ivoire');
  });

  it('reads one with old Mac line endings too', async () => {
    const { rows } = await load('countries-cr.csv', windows1252(COUNTRIES.join('\r') + '\r'));
    expect(rows).toHaveLength(4);
    expect(rows[1]![0]).toBe('Åland Islands');
  });

  it('decodes UTF-16 by its byte-order mark', () => {
    const text = 'a,b\n1,é\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    [...text].forEach((ch, i) => {
      bytes[2 + i * 2] = ch.charCodeAt(0);
    });
    // The decoder drops the byte-order mark, so it never reaches a header name.
    expect(decodeLegacyText(bytes)).toEqual({ text, encoding: 'UTF-16' });
  });

  it('leaves a UTF-8 file alone', async () => {
    const { notes, rows } = await load('countries-utf8.csv', new TextEncoder().encode(COUNTRIES.join('\n') + '\n'));
    expect(notes).toEqual([]);
    expect(rows[1]![0]).toBe('Åland Islands');
  });
});
