import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the DuckDB WebAssembly runtime into public/ before dev or build.
 *
 * Two decisions worth stating, because both look like extra work until you ask why.
 *
 * It is served from this origin rather than a CDN. A jsDelivr fetch would be simpler
 * and would also be the one outbound request this whole product claims not to make —
 * the counter on the home page measures exactly that, and would turn red. The privacy
 * claim has to survive its own instrument.
 *
 * It is copied at build time rather than committed. These files are 75 MB; the rest of
 * the repository is under half a megabyte. Committing them would make every clone pay
 * for a binary that pnpm can reproduce exactly from the lockfile.
 *
 * The coi bundle is deliberately absent. It needs COOP/COEP headers, which a static
 * host will not always let you set, and it buys threads this workload does not need.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FROM = join(HERE, '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const TO = join(HERE, '..', 'public', 'duckdb');

const FILES = [
  // Exception-handling build: smaller and faster, supported by current browsers.
  'duckdb-eh.wasm',
  'duckdb-browser-eh.worker.js',
  // Baseline build, for browsers without the exception-handling proposal.
  'duckdb-mvp.wasm',
  'duckdb-browser-mvp.worker.js',
];

await mkdir(TO, { recursive: true });

let total = 0;
for (const file of FILES) {
  const source = join(FROM, file);
  const { size } = await stat(source);
  await cp(source, join(TO, file));
  total += size;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`duckdb: copied ${FILES.length} files (${mb(total)} MB) to public/duckdb`);
