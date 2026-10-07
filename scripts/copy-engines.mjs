import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy the in-browser database engines into public/ before dev or build.
 *
 * Three engines run in the tab: DuckDB (the scratchpad and Parity Run), and
 * PostgreSQL and SQLite (the converter's real-engine check). Two decisions apply to
 * all of them, because both look like extra work until you ask why.
 *
 * They are served from this origin rather than a CDN. A jsDelivr fetch would be
 * simpler and would also be exactly the outbound request this whole product claims
 * not to make — the counter in the header measures that, and the Content Security
 * Policy forbids it. The privacy claim has to survive its own instrument.
 *
 * They are copied at build time rather than committed. Together they are over 90 MB;
 * the rest of the repository is a few megabytes. Committing them would make every
 * clone pay for binaries that pnpm reproduces exactly from the lockfile.
 *
 * DuckDB's coi bundle is deliberately absent. It needs COOP/COEP headers, which a
 * static host will not always let you set, and it buys threads this workload does
 * not need.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = join(HERE, '..', 'node_modules');
const PUBLIC = join(HERE, '..', 'public');

const ENGINES = [
  {
    name: 'duckdb',
    from: join(MODULES, '@duckdb', 'duckdb-wasm', 'dist'),
    to: join(PUBLIC, 'duckdb'),
    files: [
      // Exception-handling build: smaller and faster, supported by current browsers.
      'duckdb-eh.wasm',
      'duckdb-browser-eh.worker.js',
      // Baseline build, for browsers without the exception-handling proposal.
      'duckdb-mvp.wasm',
      'duckdb-browser-mvp.worker.js',
    ],
  },
  {
    // PostgreSQL compiled to WebAssembly. Its ES modules are served as files and
    // imported at runtime rather than bundled: Turbopack's production build breaks a
    // namespace import between PGlite's chunks ("instantiateWasm is not a function").
    // The chunk names carry content hashes, so they are listed from the directory.
    name: 'pglite',
    from: join(MODULES, '@electric-sql', 'pglite', 'dist'),
    to: join(PUBLIC, 'engines', 'pglite'),
    files: ['pglite.wasm', 'pglite.data', 'initdb.wasm', 'index.js', 'chunk-*.js'],
  },
  {
    // SQLite's ES module is served as a file rather than bundled: it builds a Worker
    // URL at runtime, which a bundler cannot follow. It has no imports of its own,
    // so the module and its wasm are the whole engine.
    name: 'sqlite',
    from: join(MODULES, '@sqlite.org', 'sqlite-wasm', 'dist'),
    to: join(PUBLIC, 'engines', 'sqlite'),
    files: ['sqlite3.wasm', ['index.mjs', 'sqlite3.mjs']],
  },
];

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

for (const engine of ENGINES) {
  await mkdir(engine.to, { recursive: true });
  let total = 0;
  const listing = await readdir(engine.from);
  // A plain name is copied as itself, a [from, to] pair is renamed on the way, and a
  // name with a * matches every file in the directory that fits it.
  const entries = engine.files.flatMap((entry) => {
    if (Array.isArray(entry)) return [entry];
    if (!entry.includes('*')) return [[entry, entry]];
    const pattern = new RegExp(`^${entry.replace(/[.]/g, '\\.').replace('*', '.*')}$`);
    return listing.filter((name) => pattern.test(name)).map((name) => [name, name]);
  });
  for (const [name, as] of entries) {
    const source = join(engine.from, name);
    const { size } = await stat(source);
    await cp(source, join(engine.to, as));
    total += size;
  }
  console.log(`${engine.name}: copied ${entries.length} files (${mb(total)} MB)`);
}
