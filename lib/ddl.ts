/**
 * DDL parsing: paste a CREATE TABLE statement, get its columns and their types.
 *
 * This is the step that turns "hand-assemble 400 field names and types into a
 * spreadsheet" into "paste the DDL". It uses dt-sql-parser, whose Hive grammar
 * understands Athena's `CREATE EXTERNAL TABLE ... STORED AS ... LOCATION ...` as well
 * as ordinary ANSI DDL.
 *
 * The parser is ~172 KB gzipped, so every entry point here loads it with a dynamic
 * import. Nothing is pulled into the initial page bundle.
 */

export interface DdlColumn {
  name: string;
  /** The declared type exactly as written, e.g. `varchar(50)` or `array<int>`. */
  type: string;
  line: number;
}

export interface DdlError {
  line: number;
  column: number;
  message: string;
}

export interface DdlParseResult {
  table?: string;
  columns: DdlColumn[];
  errors: DdlError[];
}

/**
 * Which dt-sql-parser grammar to use for a given SQL dialect.
 *
 * Only three grammars are referenced anywhere in this file, and that is deliberate:
 * the library has no subpath exports, so every grammar class named here is pulled
 * into the same chunk. Naming all seven costs roughly 1.2 MB gzipped against ~500 KB
 * for these three. Hive covers Athena, Trino and Spark well enough for DDL — it is
 * also the only grammar that parses CREATE EXTERNAL TABLE — and it backstops
 * everything else through the fallback in parseDdl.
 */
type ParserKey = 'hive' | 'mysql' | 'postgresql';

const PARSER_FOR_DIALECT: Record<string, ParserKey> = {
  trino: 'hive',
  mysql: 'mysql',
  mariadb: 'mysql',
  tidb: 'mysql',
  postgresql: 'postgresql',
  redshift: 'postgresql',
  duckdb: 'postgresql',
  hive: 'hive',
  spark: 'hive',
};

/**
 * Athena and most other dialects fall back to the Hive grammar. It is the only one
 * that parses `CREATE EXTERNAL TABLE`, and it handles plain ANSI DDL too, so it is
 * the safest default for extracting columns.
 */
function parserKeyFor(dialectId: string): ParserKey {
  return PARSER_FOR_DIALECT[dialectId] ?? 'hive';
}

async function loadParser(key: ParserKey) {
  const mod = await import('./ddl-parsers');
  switch (key) {
    case 'mysql':
      return new mod.MySQL();
    case 'postgresql':
      return new mod.PostgreSQL();
    case 'hive':
    default:
      return new mod.HiveSQL();
  }
}

/**
 * A cheap check used to offer DDL extraction without parsing on every keystroke.
 * Deliberately loose: the parse itself is the real test.
 */
export function looksLikeDdl(text: string): boolean {
  return /\bcreate\s+(or\s+replace\s+)?(external\s+|temporary\s+|temp\s+|transactional\s+)*table\b/i.test(
    text,
  );
}

interface ColumnEntity {
  text?: string;
  _colType?: { text?: string; line?: number };
}

interface TableEntity {
  text?: string;
  entityContextType?: string;
  columns?: ColumnEntity[];
}

/**
 * Only creation statements describe a schema. A plain `SELECT a, b FROM t` also
 * carries a `columns` array — the selected expressions — which would otherwise be
 * reported as typeless schema columns.
 */
function isTableCreation(entity: TableEntity): boolean {
  return (entity.entityContextType ?? '').toLowerCase().includes('tablecreate');
}

/**
 * Extract every column and its declared type from one or more CREATE TABLE statements.
 *
 * Columns arrive nested under the table entity rather than as top-level entities, and
 * the declared type lives on `_colType.text`. Constraint clauses such as
 * `PRIMARY KEY (id)` are not reported as columns, which is what we want.
 */
/**
 * Run a parser call without its console noise.
 *
 * dt-sql-parser only replaces ANTLR default console listener when you hand it one of
 * your own, and getAllEntities takes no parameter for that — so a grammar that cannot
 * read the statement writes every syntax error straight to console.error. Those errors
 * are expected here: parseDdl deliberately tries the selected dialect first and falls
 * back to Hive, so the first attempt failing is the design working, not a fault worth
 * reporting. validate() already collects the real ones.
 *
 * The call it wraps is synchronous, so nothing else can log into the gap.
 */
function withoutConsoleNoise<T>(run: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = original;
  }
}

async function parseWith(key: ParserKey, sql: string): Promise<DdlParseResult> {
  const parser = await loadParser(key);

  const errors: DdlError[] = (withoutConsoleNoise(() => parser.validate(sql)) ?? []).map((e) => ({
    line: e.startLine,
    column: e.startColumn,
    message: e.message,
  }));

  const entities = (withoutConsoleNoise(() => parser.getAllEntities(sql)) ??
    []) as unknown as TableEntity[];
  const columns: DdlColumn[] = [];
  let table: string | undefined;

  for (const entity of entities) {
    if (!isTableCreation(entity)) continue;
    if (!entity.columns || entity.columns.length === 0) continue;
    table ??= entity.text;
    for (const column of entity.columns) {
      const name = column.text?.trim();
      if (!name) continue;
      columns.push({
        name,
        type: column._colType?.text?.trim() ?? '',
        line: column._colType?.line ?? 0,
      });
    }
  }

  return { table, columns, errors };
}

export async function parseDdl(sql: string, dialectId: string): Promise<DdlParseResult> {
  if (sql.trim() === '') return { columns: [], errors: [] };

  const primary = parserKeyFor(dialectId);
  const result = await parseWith(primary, sql);
  if (result.columns.length > 0 || primary === 'hive') return result;

  // The selected dialect's grammar found nothing. Rather than making the user match
  // the dialect to the DDL before pasting, retry with Hive — it is the most permissive
  // of the set and the only one that understands CREATE EXTERNAL TABLE.
  const fallback = await parseWith('hive', sql);
  return fallback.columns.length > 0 ? fallback : result;
}

/** Render extracted columns as the `name<TAB>type` grid the generator already accepts. */
export function columnsToGrid(columns: DdlColumn[]): string {
  return columns.map((c) => `${c.name}\t${c.type}`).join('\n');
}

/* -------------------------------------------------------------------- diff */

export type DdlChangeKind = 'added' | 'removed' | 'retyped' | 'unchanged';

export interface DdlChange {
  name: string;
  kind: DdlChangeKind;
  before?: string;
  after?: string;
  /** Line each side declared the column on, for pointing at it. */
  beforeLine?: number;
  afterLine?: number;
}

/**
 * Compare two schemas. The point is to narrow a migration check to what actually
 * changed rather than re-validating every column.
 */
export function diffColumns(before: DdlColumn[], after: DdlColumn[]): DdlChange[] {
  const beforeMap = new Map(before.map((c) => [c.name.toLowerCase(), c]));
  const afterMap = new Map(after.map((c) => [c.name.toLowerCase(), c]));
  const changes: DdlChange[] = [];

  for (const column of before) {
    const match = afterMap.get(column.name.toLowerCase());
    if (!match) {
      changes.push({
        name: column.name,
        kind: 'removed',
        before: column.type,
        beforeLine: column.line,
      });
      continue;
    }
    const same = match.type.trim().toLowerCase() === column.type.trim().toLowerCase();
    changes.push({
      name: column.name,
      kind: same ? 'unchanged' : 'retyped',
      before: column.type,
      after: match.type,
      beforeLine: column.line,
      afterLine: match.line,
    });
  }

  for (const column of after) {
    if (!beforeMap.has(column.name.toLowerCase())) {
      changes.push({
        name: column.name,
        kind: 'added',
        after: column.type,
        afterLine: column.line,
      });
    }
  }

  return changes;
}
