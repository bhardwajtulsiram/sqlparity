import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import {
  ambiguousDateFormat,
  arrowConverter,
  decimalCommaColumns,
  describeCsvFailure,
  isReadOnlyQuery,
  loadSql,
  quoteName,
  readTextShapes,
  stripTrailingSemicolon,
  swappedDateFormat,
  textDisplayColumns,
  textDisplaySql,
  textShapeSql,
  thousandsColumns,
  type ArrowFieldType,
  type FileKind,
} from './scratchpad';

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

/**
 * Run a statement for the result grid, showing every value the way DuckDB writes it.
 *
 * Some types do not survive the trip through Arrow into JavaScript — see
 * `textDisplayColumns`. For a query that only reads, the column types are looked up
 * first (DESCRIBE plans the query without running it), and any such column is cast
 * to text inside the engine. Anything that cannot be described or wrapped simply runs
 * as written.
 */
export async function runForDisplay(
  connection: AsyncDuckDBConnection,
  sql: string,
  cap: number = MAX_MATERIALISED_ROWS,
): Promise<QueryOutcome> {
  if (isReadOnlyQuery(sql)) {
    try {
      const described = await connection.query(`DESCRIBE ${stripTrailingSemicolon(sql)}`);
      const pairs = described
        .toArray()
        .map((row) => [String(row.column_name), String(row.column_type)] as [string, string]);
      const cast = textDisplayColumns(pairs);
      if (cast.length > 0) {
        try {
          return await runQuery(connection, textDisplaySql(sql, cast), cap);
        } catch {
          // Fall through to the statement as written, which reports its own error.
        }
      }
    } catch {
      // Not describable — several statements, say. Run it as written.
    }
  }
  return runQuery(connection, sql, cap);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const listNames = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

/**
 * Load a dropped file as a table, reading a CSV the way a person would expect.
 *
 * Returns notes on anything that was not straightforward, so none of it is silent:
 * a load that had to look at every row to settle the types, dates whose day and month
 * could be read either way round, numbers written with a decimal comma or thousands
 * separators.
 */
export async function loadTable(
  connection: AsyncDuckDBConnection,
  table: string,
  registeredName: string,
  kind: FileKind,
): Promise<string[]> {
  const notes: string[] = [];
  const load = (options: string[] = []) => connection.query(loadSql(table, registeredName, kind, options));
  if (kind !== 'csv') {
    await load();
    return notes;
  }

  // Types are guessed from a sample of rows. When a later row does not fit, the
  // whole file is read to decide instead — one extra pass, and the load succeeds.
  let options: string[] = [];
  try {
    await load();
  } catch (error) {
    const reason = describeCsvFailure(message(error));
    if (!reason) throw error;
    const said = reason.charAt(0).toUpperCase() + reason.slice(1);
    try {
      options = ['sample_size=-1'];
      await load(options);
      notes.push(`${said}, so the column types were worked out from every row instead of a sample.`);
    } catch {
      options = ['all_varchar=true'];
      await load(options);
      notes.push(
        `${said}, and no consistent types could be found, so every column was read as text. Cast columns in your query where you need numbers or dates.`,
      );
    }
  }

  const path = registeredName.replaceAll("'", "''");
  let delimiter = ',';
  try {
    const sniffed = await runQuery(connection, `SELECT Delimiter, DateFormat FROM sniff_csv('${path}')`);
    delimiter = String(sniffed.rows[0]?.[0] ?? ',');
    const dateFormat = sniffed.rows[0]?.[1];
    const order = typeof dateFormat === 'string' ? ambiguousDateFormat(dateFormat) : null;
    if (order && typeof dateFormat === 'string') {
      notes.push(
        `Dates were read ${order}. If the file puts them the other way round, reload it by running: CREATE OR REPLACE TABLE "${quoteName(table)}" AS SELECT * FROM read_csv_auto('${path}', dateformat='${swappedDateFormat(dateFormat)}')`,
      );
    }
  } catch {
    // Older engines have no sniff_csv. The load itself is fine; only the note is lost.
  }

  if (options.includes('all_varchar=true')) return notes;

  const described = await runQuery(connection, `DESCRIBE "${quoteName(table)}"`);
  const textColumns = described.rows.filter((row) => String(row[1]) === 'VARCHAR').map((row) => String(row[0]));
  if (textColumns.length === 0) return notes;

  const shapeRow = await runQuery(connection, textShapeSql(table, textColumns));
  const shapes = readTextShapes(textColumns, shapeRow.rows[0] ?? []);

  const comma = decimalCommaColumns(shapes);
  if (comma.length > 0 && delimiter !== ',') {
    try {
      await load([...options, "decimal_separator=','"]);
      notes.push(
        `${listNames(comma)} ${comma.length === 1 ? 'is a number' : 'are numbers'} written with a decimal comma (1,5), so the file was read with a comma as the decimal point.`,
      );
    } catch {
      // Leave the table as first loaded.
    }
  } else if (comma.length > 0) {
    notes.push(
      `${listNames(comma)} ${comma.length === 1 ? 'looks' : 'look'} like numbers with a decimal comma, but the file is comma-separated, so ${comma.length === 1 ? 'it stays' : 'they stay'} text. Convert in a query with replace("${comma[0]}", ',', '.')::DOUBLE.`,
    );
  }

  const thousands = thousandsColumns(shapes);
  if (thousands.length > 0) {
    notes.push(
      `${listNames(thousands)} ${thousands.length === 1 ? 'holds numbers' : 'hold numbers'} written with thousands separators (1,234.56), so ${thousands.length === 1 ? 'it was' : 'they were'} read as text. To use them as numbers: replace("${thousands[0]}", ',', '')::DECIMAL(18,2).`,
    );
  }

  return notes;
}

/**
 * Write the query's full result as CSV, using DuckDB's own writer.
 *
 * Deliberately not built from the rows on screen. Those are capped twice — 2,000 out
 * of Arrow and 500 rendered — so a file assembled from them would silently hand back
 * a fraction of a large result, which is the failure mode this project exists to
 * refuse. COPY streams every row inside the engine, and DuckDB's CSV writer already
 * knows how to quote a value containing a comma, a quote or a newline.
 *
 * The file is written into DuckDB's in-memory filesystem and dropped afterwards, so
 * nothing touches the disk until the browser saves it.
 */
export async function exportCsv(
  db: AsyncDuckDB,
  connection: AsyncDuckDBConnection,
  sql: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const name = `sqlparity-export-${Date.now()}.csv`;
  const statement = stripTrailingSemicolon(sql);

  await connection.query(`COPY (${statement}) TO '${name}' (FORMAT CSV, HEADER)`);
  try {
    const bytes = await db.copyFileToBuffer(name);
    // Copy into a plain ArrayBuffer. The engine's buffer can be shared memory, which
    // Blob refuses, and the copy is freed with the file below either way.
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);
    return owned;
  } finally {
    // Otherwise every export leaks a copy of the result into the engine's memory.
    await db.dropFile(name).catch(() => {});
  }
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
