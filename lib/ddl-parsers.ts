/**
 * The only place dt-sql-parser is imported.
 *
 * These are static named imports on purpose. A dynamic `import('dt-sql-parser')`
 * followed by runtime property access (`mod[name]`) gives the bundler nothing to
 * analyse, so it keeps all seven grammars — about 1.2 MB gzipped. Naming the three
 * we need statically lets the unused grammars be dropped.
 *
 * They are used for query syntax checking only (lib/validate.ts). CREATE TABLE
 * statements are read by lib/ddl.ts, which does not need a grammar: DDL arrives from
 * every engine, and a grammar that only knows one of them stops at the first clause
 * it does not recognise.
 *
 * This module is itself only reached through a dynamic import, so none of it lands in
 * the initial page bundle.
 */
export { MySQL, PostgreSQL, TrinoSQL } from 'dt-sql-parser';
