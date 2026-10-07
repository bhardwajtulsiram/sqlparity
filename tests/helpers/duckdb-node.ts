import { createRequire } from 'node:module';
import path from 'node:path';
import type { QueryFn } from '../../lib/parity-run';
import { arrowConverter, type ArrowFieldType } from '../../lib/scratchpad';

/**
 * DuckDB's own Node build, so tests run the same SQL engine the browser does.
 *
 * The blocking build needs no worker thread; it is slower to start than a native
 * binding but is the same WebAssembly the scratchpad and Parity Run load.
 */
const require = createRequire(import.meta.url);
const dist = path.join(process.cwd(), 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');

export interface NodeDuckDb {
  query: QueryFn;
  exec: (sql: string) => void;
  /** Make text available as a file, the way a dropped File is registered in the tab. */
  registerText: (name: string, text: string) => Promise<void>;
  /** Make raw bytes available as a file, for files that are not UTF-8. */
  registerBytes: (name: string, bytes: Uint8Array) => Promise<void>;
  /** The raw connection, for code that takes DuckDB's own connection type. */
  connection: unknown;
  close: () => void;
}

export async function openDuckDb(): Promise<NodeDuckDb> {
  const duckdb = require(path.join(dist, 'duckdb-node-blocking.cjs'));
  const bundles = {
    mvp: {
      mainModule: path.join(dist, 'duckdb-mvp.wasm'),
      mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs'),
    },
    eh: {
      mainModule: path.join(dist, 'duckdb-eh.wasm'),
      mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs'),
    },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate(() => {});
  const conn = db.connect();

  const query: QueryFn = async (sql) => {
    const table = conn.query(sql);
    const fields: { name: string; type: unknown }[] = table.schema.fields;
    const columns = fields.map((f) => f.name);
    // The same conversion lib/duckdb.ts applies in the browser, so decimals and dates
    // reach the code under test in the shape they do in the tab.
    const convert = fields.map((f) => arrowConverter(f.type as ArrowFieldType));
    const rows = table
      .toArray()
      .map((row: Record<string, unknown>) =>
        columns.map((c, i) => (convert[i] ? convert[i]!(row[c]) : row[c])),
      );
    return { columns, rows };
  };

  return {
    query,
    exec: (sql) => {
      conn.query(sql);
    },
    registerText: async (name, text) => {
      await db.registerFileText(name, text);
    },
    registerBytes: async (name, bytes) => {
      await db.registerFileBuffer(name, bytes);
    },
    connection: conn,
    close: () => {
      conn.close();
    },
  };
}
