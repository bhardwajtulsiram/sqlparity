import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import { arrowConverter, type ArrowFieldType } from './scratchpad';

/**
 * Lazily start DuckDB, from this origin only.
 *
 * The published bundles point at jsDelivr, and using them would be one line shorter
 * and would also be the single outbound request this product promises not to make.
 * scripts/copy-duckdb.mjs puts the runtime under public/duckdb instead, and the paths
 * below are same-origin and relative — so the engine loads under the same rule as
 * everything else here, and the home page's request counter stays honest.
 *
 * The whole module is dynamically imported by the one route that needs it. Nothing
 * about it reaches any other page's bundle.
 */

/** Roughly what the download costs, for copy that warns before it starts. */
export const ENGINE_DOWNLOAD_MB = 7.7;

type Bundles = Record<'mvp' | 'eh', { mainModule: string; mainWorker: string }>;

const BUNDLES: Bundles = {
  // Baseline, for a browser without the WebAssembly exception-handling proposal.
  mvp: {
    mainModule: '/duckdb/duckdb-mvp.wasm',
    mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
  },
  // Smaller and faster; what current browsers will pick.
  eh: {
    mainModule: '/duckdb/duckdb-eh.wasm',
    mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
  },
};

let starting: Promise<AsyncDuckDB> | null = null;

async function start(): Promise<AsyncDuckDB> {
  const duckdb = await import('@duckdb/duckdb-wasm');

  const bundle = await duckdb.selectBundle(BUNDLES);
  if (!bundle.mainWorker) throw new Error('This browser cannot run the DuckDB worker.');

  const worker = new Worker(bundle.mainWorker);
  // WARNING, not INFO: DuckDB is chatty at startup and the console is somewhere a
  // reader might reasonably go to check nothing is being sent anywhere.
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

/** Start the engine, or hand back the one already starting or started. */
export function getDuckDb(): Promise<AsyncDuckDB> {
  if (!starting) {
    starting = start().catch((error) => {
      // Let the next attempt actually retry rather than resolving a rejected promise.
      starting = null;
      throw error;
    });
  }
  return starting;
}

/** True once the engine is up, so the UI can skip the download warning. */
export function engineStarted(): boolean {
  return starting !== null;
}

export interface QueryOutcome {
  columns: string[];
  /** Materialised rows, capped at `cap`. */
  rows: unknown[][];
  /** Rows the query actually produced, read from Arrow without copying them. */
  totalRows: number;
  /** Milliseconds the engine spent, for the result footer. */
  elapsedMs: number;
}

/**
 * How many rows to copy out of Arrow.
 *
 * DuckDB answers `SELECT * FROM a_ten_million_row_parquet` almost instantly; it is
 * turning those rows into JavaScript arrays that locks the tab. The true count comes
 * from Arrow's own metadata, so capping this loses nothing but the rows nobody can
 * read anyway.
 */
export const MAX_MATERIALISED_ROWS = 2000;

/**
 * Run one statement and return plain rows.
 *
 * Arrow's own row objects are lazy proxies that do not survive being held in React
 * state, so the values are copied out here while the result is still alive.
 */
export async function runQuery(
  connection: AsyncDuckDBConnection,
  sql: string,
  cap: number = MAX_MATERIALISED_ROWS,
): Promise<QueryOutcome> {
  const started = performance.now();
  const table = await connection.query(sql);
  const elapsedMs = performance.now() - started;

  const columns = table.schema.fields.map((field) => field.name);
  const totalRows = table.numRows;


  // Decimals and dates come out of Arrow in a shape that is wrong to print; convert
  // them here, where the column type is still to hand.
  const convert = table.schema.fields.map((field) =>
    arrowConverter(field.type as unknown as ArrowFieldType),
  );

  const rows: unknown[][] = [];
  for (const row of table.toArray()) {
    if (rows.length >= cap) break;
    rows.push(
      columns.map((column, i) => {
        const value = row[column];
        const converter = convert[i];
        return converter ? converter(value) : value;
      }),
    );
  }

  return { columns, rows, totalRows, elapsedMs };
}

/** Register a dropped file with the engine without reading it into memory. */
export async function registerFile(db: AsyncDuckDB, name: string, file: File): Promise<void> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  // BROWSER_FILEREADER streams from the File handle, so a Parquet file larger than
  // memory is still queryable and nothing is copied until a query touches it.
  await db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
}

/** The tables currently loaded, for the file list. */
export async function listTables(
  connection: AsyncDuckDBConnection,
): Promise<{ name: string; rows: number }[]> {
  const { rows } = await runQuery(
    connection,
    "SELECT table_name, estimated_size FROM duckdb_tables() WHERE schema_name = 'main' ORDER BY table_name",
  );
  return rows.map(([name, size]) => ({
    name: String(name),
    rows: Number(size ?? 0),
  }));
}
