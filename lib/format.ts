import {
  formatDialect,
  bigquery,
  clickhouse,
  db2,
  duckdb,
  hive,
  mariadb,
  mysql,
  plsql,
  postgresql,
  redshift,
  snowflake,
  spark,
  sql as ansiSql,
  sqlite,
  transactsql,
  trino,
} from 'sql-formatter';
import type { Dialect } from './dialects';
import { scan } from './tokenize';

/**
 * `formatDialect` with a named dialect is used rather than `format({ language })`.
 * The string-keyed API cannot be tree-shaken and drags in every dialect the library
 * ships (~75 KB gzip against ~18 KB for a single dialect).
 */
const FORMATTER_DIALECTS = {
  bigquery,
  clickhouse,
  db2,
  duckdb,
  hive,
  mariadb,
  mysql,
  plsql,
  postgresql,
  redshift,
  snowflake,
  spark,
  sql: ansiSql,
  sqlite,
  transactsql,
  trino,
} as const;

export type KeywordCase = 'preserve' | 'upper' | 'lower';
export type CommaPosition = 'trailing' | 'leading';
export type IndentStyle = 'standard' | 'tabularLeft' | 'tabularRight';

export interface FormatSettings {
  keywordCase: KeywordCase;
  dataTypeCase: KeywordCase;
  functionCase: KeywordCase;
  identifierCase: KeywordCase;
  indentStyle: IndentStyle;
  tabWidth: number;
  useTabs: boolean;
  expressionWidth: number;
  linesBetweenQueries: number;
  logicalOperatorNewline: 'before' | 'after';
  denseOperators: boolean;
  newlineBeforeSemicolon: boolean;
  commaPosition: CommaPosition;
}

export const DEFAULT_FORMAT: FormatSettings = {
  keywordCase: 'upper',
  dataTypeCase: 'preserve',
  functionCase: 'preserve',
  identifierCase: 'preserve',
  indentStyle: 'standard',
  tabWidth: 2,
  useTabs: false,
  expressionWidth: 50,
  linesBetweenQueries: 1,
  logicalOperatorNewline: 'before',
  denseOperators: false,
  newlineBeforeSemicolon: false,
  commaPosition: 'trailing',
};

/**
 * Template placeholders — dbt/Jinja `{{ ref('x') }}`, `{% if %}` and `{# #}`, and this
 * app's own `{{field}}` — kept as opaque tokens. Without this the formatter reads the
 * braces as syntax and refuses the whole query.
 *
 * Only passed when the text has one: supplying parameter types replaces the dialect's
 * own (`$1`, `?`, `:name`), which would stop those formatting.
 */
const TEMPLATE_PARAMS = {
  custom: [
    { regex: String.raw`\{\{[\s\S]*?\}\}` },
    { regex: String.raw`\{%[\s\S]*?%\}` },
    { regex: String.raw`\{#[\s\S]*?#\}` },
  ],
};
const HAS_TEMPLATE = /\{\{|\{%|\{#/;

export interface FormatOutcome {
  sql: string;
  error?: string;
}

export function formatSql(
  input: string,
  dialect: Dialect,
  settings: FormatSettings,
): FormatOutcome {
  if (input.trim() === '') return { sql: '' };

  const target = FORMATTER_DIALECTS[dialect.formatter as keyof typeof FORMATTER_DIALECTS];
  if (!target) return { sql: input, error: `No formatter available for ${dialect.label}.` };

  try {
    const formatted = formatDialect(input, {
      dialect: target,
      keywordCase: settings.keywordCase,
      dataTypeCase: settings.dataTypeCase,
      functionCase: settings.functionCase,
      identifierCase: settings.identifierCase,
      indentStyle: settings.indentStyle,
      tabWidth: settings.tabWidth,
      useTabs: settings.useTabs,
      expressionWidth: settings.expressionWidth,
      linesBetweenQueries: settings.linesBetweenQueries,
      logicalOperatorNewline: settings.logicalOperatorNewline,
      denseOperators: settings.denseOperators,
      newlineBeforeSemicolon: settings.newlineBeforeSemicolon,
      ...(HAS_TEMPLATE.test(input) ? { paramTypes: TEMPLATE_PARAMS } : {}),
    });

    return {
      sql:
        settings.commaPosition === 'leading' ? toLeadingCommas(formatted, dialect) : formatted,
    };
  } catch (err) {
    // sql-formatter throws on input it cannot tokenise. Keep the user's text on screen
    // rather than blanking it, and say what happened.
    return { sql: input, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Move end-of-line commas to the start of the following line.
 *
 * sql-formatter has no comma-position option, so this is our own pass. It only moves
 * commas that already end a line, which is what makes it safe: a comma inside
 * `count(a, b)` or inside a string never sits at end of line, so it is never touched.
 * The scan is still required — a line could legitimately end with a comma inside a
 * multi-line string literal or a block comment.
 */
export function toLeadingCommas(sql: string, dialect: Dialect): string {
  const segments = scan(sql, dialect);

  const segmentAt = (index: number) => segments.find((seg) => index >= seg.start && index < seg.end);

  const lines = sql.split('\n');
  const out: string[] = [];
  let offset = 0;
  let pendingComma = false;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    let body = line;
    if (pendingComma) {
      const indent = body.match(/^[ \t]*/)?.[0] ?? '';
      const rest = body.slice(indent.length);
      body = indent.length >= 2 ? `${indent.slice(0, -2)}, ${rest}` : `, ${rest}`;
      pendingComma = false;
    }

    // Look past a comment at the end of the line: `a, -- first` still ends in a comma.
    let end = line.replace(/[ \t]+$/, '').length;
    for (;;) {
      const last = segmentAt(lineStart + end - 1);
      if (!last || last.kind !== 'comment' || last.start < lineStart) break;
      end = line.slice(0, last.start - lineStart).replace(/[ \t]+$/, '').length;
    }
    const commaAt = end - 1;
    if (commaAt >= 0 && line[commaAt] === ',' && segmentAt(lineStart + commaAt)?.kind === 'code') {
      // Only defer the comma when there is a following line to carry it.
      pendingComma = true;
      const at = commaAt + (body.length - line.length);
      const comment = body.slice(at + 1).trim();
      body = body.slice(0, at).replace(/[ \t]+$/, '') + (comment ? ` ${comment}` : '');
    }

    out.push(body);
  }

  // A trailing comma with nothing after it stays where it was.
  if (pendingComma) {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.trim() !== '') {
        out[i] = `${out[i]},`;
        break;
      }
    }
  }

  return out.join('\n');
}
