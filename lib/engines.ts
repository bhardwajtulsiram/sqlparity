import type { PGlite } from '@electric-sql/pglite';
import { setupFor, type EngineId, type EngineRows } from './engine-check';

/**
 * The three database engines that run inside the tab, behind one interface.
 *
 * Each starts on first use only — PostgreSQL is a 16 MB download — and every file it
 * loads comes from this site (see scripts/copy-engines.mjs), so a check makes no
 * request the Content Security Policy would have to allow.
 *
 * Every check is isolated: the sample tables are created, the query runs, and the
 * tables are gone before the next check. PostgreSQL and DuckDB do it with a
 * transaction that is always rolled back. SQLite cannot ATTACH a schema inside a
 * transaction, but an in-memory SQLite database is cheap, so it gets a fresh one.
 */

/** What each engine costs to download the first time, for the button label. */
export const DOWNLOAD_MB: Record<EngineId, number> = {
  postgres: 16,
  sqlite: 1.4,
  duckdb: 7.7,
};

export class CheckError extends Error {
  /** Which part failed: the sample tables, or the query itself. */
  readonly stage: 'setup' | 'query';
  constructor(stage: 'setup' | 'query', message: string) {
    super(message);
    this.stage = stage;
  }
}

export interface CheckEngine {
  id: EngineId;
  /** As the engine reports itself, e.g. "PostgreSQL 17.5". */
  version: string;
  run: (setup: string, sql: string) => Promise<EngineRows>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Strip one trailing semicolon; PGlite's query() takes a single statement. */
function single(sql: string): string {
  return sql.trim().replace(/;\s*$/, '');
}

/* ----------------------------------------------------------------- Postgres */

/**
 * Text for every date and time type, so Postgres hands back `2026-01-15 09:30:00`
 * rather than a JavaScript Date shifted into the viewer's time zone, and numerics
 * stay exact strings instead of becoming floats.
 */
const RAW = (value: string) => value;
const RAW_TYPES = {
  20: RAW, // int8
  1700: RAW, // numeric
  1082: RAW, // date
  1083: RAW, // time
  1114: RAW, // timestamp
  1184: RAW, // timestamptz
  1266: RAW, // timetz
};

/**
 * PGlite's own ES modules, served from this site and imported at runtime. Bundling
 * them works in development but not in Turbopack's production build, which breaks a
 * namespace import between PGlite's chunks. See scripts/copy-engines.mjs.
 */
const PGLITE_MODULE = '/engines/pglite/index.js';

async function startPostgres(): Promise<CheckEngine> {
  const [{ PGlite }, pgliteWasm, initdbWasm, bundle] = await Promise.all([
    import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PGLITE_MODULE) as Promise<{
      PGlite: typeof import('@electric-sql/pglite').PGlite;
    }>,
    WebAssembly.compileStreaming(fetch('/engines/pglite/pglite.wasm')),
    WebAssembly.compileStreaming(fetch('/engines/pglite/initdb.wasm')),
    fetch('/engines/pglite/pglite.data').then((r) => {
      if (!r.ok) throw new Error(`Could not load the PostgreSQL data bundle (${r.status}).`);
      return r.blob();
    }),
  ]);

  const pg: PGlite = await PGlite.create({
    pgliteWasmModule: pgliteWasm,
    initdbWasmModule: initdbWasm,
    fsBundle: bundle,
    parsers: RAW_TYPES,
  });

  const version = await pg.query<[string]>(`SHOW server_version`, [], { rowMode: 'array' });
  const queue = serial();

  return {
    id: 'postgres',
    version: `PostgreSQL ${String(version.rows[0]?.[0] ?? '').split(' ')[0]}`,
    run: (setup, sql) =>
      queue(async () => {
        await pg.exec('BEGIN');
        try {
          if (setup.trim()) {
            try {
              await pg.exec(setupFor('postgres', setup));
            } catch (error) {
              throw new CheckError('setup', message(error));
            }
          }
          try {
            const result = await pg.query<unknown[]>(single(sql), [], { rowMode: 'array' });
            return { columns: result.fields.map((f) => f.name), rows: result.rows };
          } catch (error) {
            throw new CheckError('query', message(error));
          }
        } finally {
          await pg.exec('ROLLBACK').catch(() => {});
        }
      }),
  };
}

/* ------------------------------------------------------------------- SQLite */

/**
 * Loaded from this site at runtime, not bundled: the package builds a Worker URL from
 * `import.meta.url`, which Turbopack cannot resolve. scripts/copy-engines.mjs puts the
 * module beside its wasm, and the import below is left alone by the bundler.
 */
const SQLITE_MODULE = '/engines/sqlite/sqlite3.mjs';

async function startSqlite(): Promise<CheckEngine> {
  const module: { default: unknown } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ SQLITE_MODULE);
  const init = module.default as (options: object) => Promise<{
    version: { libVersion: string };
    oo1: { DB: new (name: string) => SqliteDb };
  }>;
  const sqlite3 = await init({
    locateFile: () => '/engines/sqlite/sqlite3.wasm',
    print: () => {},
    printErr: () => {},
  });

  return {
    id: 'sqlite',
    version: `SQLite ${sqlite3.version.libVersion}`,
    run: async (setup, sql) => {
      const db = new sqlite3.oo1.DB(':memory:');
      try {
        if (setup.trim()) {
          try {
            db.exec(setupFor('sqlite', setup));
          } catch (error) {
            throw new CheckError('setup', message(error));
          }
        }
        try {
          const rows: unknown[][] = [];
          const columns: string[] = [];
          db.exec({ sql, rowMode: 'array', resultRows: rows, columnNames: columns });
          return { columns, rows };
        } catch (error) {
          throw new CheckError('query', message(error));
        }
      } finally {
        db.close();
      }
    },
  };
}

interface SqliteDb {
  exec(sql: string | { sql: string; rowMode: 'array'; resultRows: unknown[][]; columnNames: string[] }): void;
  close(): void;
}

/* ------------------------------------------------------------------- DuckDB */

async function startDuckDb(): Promise<CheckEngine> {
  const { getDuckDb, runQuery } = await import('./duckdb');
  const db = await getDuckDb();
  // Its own connection, so a check never sees or disturbs the scratchpad's tables.
  const connection = await db.connect();
  const version = await runQuery(connection, 'SELECT version()');
  const queue = serial();

  return {
    id: 'duckdb',
    version: `DuckDB ${String(version.rows[0]?.[0] ?? '')}`,
    run: (setup, sql) =>
      queue(async () => {
        await connection.query('BEGIN TRANSACTION');
        try {
          if (setup.trim()) {
            try {
              await connection.query(setupFor('duckdb', setup));
            } catch (error) {
              throw new CheckError('setup', message(error));
            }
          }
          try {
            const result = await runQuery(connection, sql);
            return { columns: result.columns, rows: result.rows };
          } catch (error) {
            throw new CheckError('query', message(error));
          }
        } finally {
          await connection.query('ROLLBACK').catch(() => {});
        }
      }),
  };
}

/* ------------------------------------------------------------------ startup */

/** Run one task at a time, so two checks never share an open transaction. */
function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = tail.then(task, task);
    tail = next.catch(() => {});
    return next;
  };
}

const starting = new Map<EngineId, Promise<CheckEngine>>();
const START: Record<EngineId, () => Promise<CheckEngine>> = {
  postgres: startPostgres,
  sqlite: startSqlite,
  duckdb: startDuckDb,
};

/** Start an engine, or hand back the one already starting or started. */
export function getEngine(id: EngineId): Promise<CheckEngine> {
  let engine = starting.get(id);
  if (!engine) {
    engine = START[id]().catch((error) => {
      // Let the next attempt actually retry.
      starting.delete(id);
      throw error;
    });
    starting.set(id, engine);
  }
  return engine;
}

/** True once an engine has been asked for, so the UI can drop the download warning. */
export function engineRequested(id: EngineId): boolean {
  return starting.has(id);
}
