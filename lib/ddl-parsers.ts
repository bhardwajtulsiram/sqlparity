/**
 * The only place dt-sql-parser is imported.
 *
 * These are static named imports on purpose. A dynamic `import('dt-sql-parser')`
 * followed by runtime property access (`mod[name]`) gives the bundler nothing to
 * analyse, so it keeps all seven grammars — about 1.2 MB gzipped. Naming the four
 * we need statically lets the unused grammars (Impala, Flink, Spark) be dropped.
 *
 * Four, not three: Hive and Trino are both kept even though Athena is one dialect,
 * because Athena's DDL and its query syntax are genuinely different grammars.
 * `CREATE EXTERNAL TABLE ... STORED AS ... LOCATION ...` is Hive-flavored DDL (Athena
 * uses a Hive-Metastore-compatible catalog), while `SELECT` syntax is real Trino.
 * lib/ddl.ts uses Hive for the former; lib/validate.ts uses Trino for the latter.
 *
 * This module is itself only reached through a dynamic import (see lib/ddl.ts and
 * lib/validate.ts), so none of it lands in the initial page bundle.
 */
export { HiveSQL, MySQL, PostgreSQL, TrinoSQL } from 'dt-sql-parser';
