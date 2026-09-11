import type { GeneratedQuery } from './generate';

/**
 * Excel's hard per-cell limit. Excel counts UTF-16 code units, so an astral character
 * costs two. We guard below the limit to leave headroom rather than handing the writer
 * a value Excel will refuse — an oversized cell shows up as the "we found a problem
 * with some content" repair dialog, which reads to a user as a corrupt file.
 */
export const EXCEL_CELL_LIMIT = 32_767;
const EXCEL_CELL_GUARD = 32_000;

export interface TruncationReport {
  truncated: number;
  limit: number;
}

export function fitExcelCell(text: string): { value: string; truncated: boolean } {
  if (text.length <= EXCEL_CELL_GUARD) return { value: text, truncated: false };
  const kept = text.slice(0, EXCEL_CELL_GUARD);
  return {
    value: `${kept}\n…[truncated, ${text.length.toLocaleString()} characters total — use the .sql download for the full query]`,
    truncated: true,
  };
}

/* ------------------------------------------------------------------- files */

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next task so the download has taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** All statements in one file, each preceded by a numbered comment header. */
export function buildSqlFile(queries: GeneratedQuery[]): string {
  return queries
    .map((q) => {
      const header = `-- ${q.index}. ${q.label}${q.dataType ? ` (${q.dataType})` : ''}`;
      const body = q.sql.trimEnd();
      const terminated = body.endsWith(';') ? body : `${body};`;
      return `${header}\n${terminated}`;
    })
    .join('\n\n');
}

export function downloadSqlFile(queries: GeneratedQuery[], filename = 'queries.sql'): void {
  triggerDownload(new Blob([buildSqlFile(queries)], { type: 'application/sql' }), filename);
}

/** A safe, stable filename fragment for one query. */
export function queryFilename(query: GeneratedQuery, total: number): string {
  const width = String(total).length;
  const number = String(query.index).padStart(width, '0');
  const slug = query.label
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug ? `${number}_${slug}.sql` : `${number}.sql`;
}

/** One .sql file per query, delivered as a zip. */
export async function downloadNumberedSet(
  queries: GeneratedQuery[],
  filename = 'queries.zip',
): Promise<void> {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const query of queries) {
    const body = query.sql.trimEnd();
    files[queryFilename(query, queries.length)] = strToU8(
      body.endsWith(';') ? body : `${body};`,
    );
  }
  const zipped = zipSync(files, { level: 6 });
  triggerDownload(
    new Blob([zipped as unknown as BlobPart], { type: 'application/zip' }),
    filename,
  );
}

/* ------------------------------------------------------------------- excel */

/**
 * One query per row, with blank Status and Notes columns to work through.
 *
 * No formula escaping is applied, and that is deliberate. In an .xlsx file a string
 * cell and a formula cell are different XML constructs, so Excel never reinterprets
 * a leading "=" in a string as a formula. Apostrophe-prefixing would corrupt every
 * query that legitimately starts with a "--" comment.
 */
export async function downloadExcel(
  queries: GeneratedQuery[],
  filename = 'queries.xlsx',
): Promise<TruncationReport> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  let truncated = 0;
  const header = ['#', 'Field', 'Data type', 'Query', 'Status', 'Notes'];

  const rows = [
    header.map((value) => ({ value, fontWeight: 'bold' as const })),
    ...queries.map((query) => {
      const fitted = fitExcelCell(query.sql);
      if (fitted.truncated) truncated++;
      return [
        { value: query.index, type: Number },
        { value: query.label, type: String },
        { value: query.dataType, type: String },
        { value: fitted.value, type: String },
        { value: '', type: String },
        { value: '', type: String },
      ];
    }),
  ];

  // `.toBlob()` rather than `.toFile()` so every export in this module goes through
  // the same download path.
  const blob = await writeExcelFile(rows as never, {
    columns: [
      { width: 6 },
      { width: 34 },
      { width: 16 },
      { width: 90 },
      { width: 12 },
      { width: 30 },
    ],
    sheet: 'Queries',
  }).toBlob();

  triggerDownload(blob, filename);

  return { truncated, limit: EXCEL_CELL_LIMIT };
}
