/**
 * Two small files to try Parity Run on, with the differences a real migration makes.
 *
 * Each difference is one a loader actually introduces, and each is catchable by a
 * different part of the tool — so the example shows the verdict, the per-column
 * counts, the samples and the normalisation options all doing something:
 *
 *   1012  dropped from the target                     → a key only in the source
 *   1013  appears only in the target                  → a key only in the target
 *   1003  name gained a trailing space                → fixed by "Ignore whitespace"
 *   1004  email upper-cased                           → fixed by "Ignore case"
 *   1007  1840.50 written as 1840.49                  → fixed by a 0.01 tolerance
 *   1009  country lost, written as an empty string    → a real difference
 *   loaded_at, added by the loader                    → a column only in the target
 */

const HEADER = 'customer_id,name,email,country,lifetime_value,signup_date';

const SOURCE_ROWS = [
  '1001,Ada Lovelace,ada@example.com,GB,12890.00,2024-02-11',
  '1002,Grace Hopper,grace@example.com,US,8420.75,2024-03-02',
  '1003,Alan Turing,alan@example.com,GB,560.00,2024-03-19',
  '1004,Katherine Johnson,katherine@example.com,US,3310.20,2024-04-07',
  '1005,Edsger Dijkstra,edsger@example.com,NL,990.00,2024-04-21',
  '1006,Barbara Liskov,barbara@example.com,US,15020.10,2024-05-13',
  '1007,Donald Knuth,donald@example.com,US,1840.50,2024-06-01',
  '1008,Margaret Hamilton,margaret@example.com,US,7300.00,2024-06-18',
  '1009,Niklaus Wirth,niklaus@example.com,CH,450.40,2024-07-09',
  '1010,Frances Allen,frances@example.com,US,2210.00,2024-08-14',
  '1011,Tim Berners-Lee,tim@example.com,GB,6105.95,2024-09-03',
  '1012,Radia Perlman,radia@example.com,US,980.00,2024-09-27',
];

const TARGET_ROWS = [
  '1001,Ada Lovelace,ada@example.com,GB,12890.00,2024-02-11,2026-10-01 02:00:00',
  '1002,Grace Hopper,grace@example.com,US,8420.75,2024-03-02,2026-10-01 02:00:00',
  '1003,Alan Turing ,alan@example.com,GB,560.00,2024-03-19,2026-10-01 02:00:00',
  '1004,Katherine Johnson,KATHERINE@EXAMPLE.COM,US,3310.20,2024-04-07,2026-10-01 02:00:00',
  '1005,Edsger Dijkstra,edsger@example.com,NL,990.00,2024-04-21,2026-10-01 02:00:00',
  '1006,Barbara Liskov,barbara@example.com,US,15020.10,2024-05-13,2026-10-01 02:00:00',
  '1007,Donald Knuth,donald@example.com,US,1840.49,2024-06-01,2026-10-01 02:00:00',
  '1008,Margaret Hamilton,margaret@example.com,US,7300.00,2024-06-18,2026-10-01 02:00:00',
  '1009,Niklaus Wirth,niklaus@example.com,"",450.40,2024-07-09,2026-10-01 02:00:00',
  '1010,Frances Allen,frances@example.com,US,2210.00,2024-08-14,2026-10-01 02:00:00',
  '1011,Tim Berners-Lee,tim@example.com,GB,6105.95,2024-09-03,2026-10-01 02:00:00',
  '1013,Ken Thompson,ken@example.com,US,3150.00,2024-10-02,2026-10-01 02:00:00',
];

export const EXAMPLE_FILES = {
  source: { name: 'customers.csv', text: [HEADER, ...SOURCE_ROWS].join('\n') + '\n' },
  target: { name: 'customers_copy.csv', text: [`${HEADER},loaded_at`, ...TARGET_ROWS].join('\n') + '\n' },
};

/** The example as File objects, ready for the same loading path a dropped file takes. */
export function exampleFiles(): { source: File; target: File } {
  const make = (f: { name: string; text: string }) => new File([f.text], f.name, { type: 'text/csv' });
  return { source: make(EXAMPLE_FILES.source), target: make(EXAMPLE_FILES.target) };
}

/** Largest file hashed for the report. Reading more than this into memory at once can crash a tab. */
export const MAX_HASH_BYTES = 1024 * 1024 * 1024;

/** Hex SHA-256 of a file's bytes, or null when the file is too large to hash in a tab. */
export async function sha256File(file: Blob): Promise<string | null> {
  if (file.size > MAX_HASH_BYTES || typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
