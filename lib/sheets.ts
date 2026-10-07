import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { decodeLegacyText } from './scratchpad';

/**
 * SQL kept in spreadsheets: a workbook of report queries, a CSV export of a query log.
 *
 * Excel (.xlsx, .xlsm) and CSV/TSV files are read in the tab, every cell that holds a
 * SQL statement is found, and after formatting or converting, the same file is
 * written back with only those cells changed. Everything else — other cells, other
 * sheets, styles, formulas, macros — is copied byte for byte: a workbook is a zip of
 * XML parts, and only the text of the changed cells is spliced into its sheet's XML.
 * A CSV is spliced the same way, so untouched fields keep their exact quoting.
 */

export type SheetKind = 'xlsx' | 'csv';

export interface SheetCell {
  /** Unique inside the file: `Sheet1!B12` for a workbook, `B12` for a CSV. */
  ref: string;
  /** For people: the ref, plus the column's header when row 1 has one. */
  label: string;
  text: string;
}

export interface SheetDoc {
  kind: SheetKind;
  /** The file as it was read, returned as is when no cell changed. */
  bytes: Uint8Array;
  /** The SQL cells, in sheet and reading order. */
  cells: SheetCell[];
  /** The file again, with the given cells (by ref) holding new text. */
  write(changes: Map<string, string>): Uint8Array;
}

/** Excel's limit on the characters in one cell. A longer result would be cut off. */
export const EXCEL_CELL_LIMIT = 32_767;

/** Workbooks and CSVs are mostly data, so they may be larger than a SQL file. */
export const MAX_SHEET_BYTES = 25 * 1024 * 1024;

const SHEET_FILE = /\.(xlsx|xlsm|csv|tsv)$/i;

export function isSheetFile(path: string): boolean {
  return SHEET_FILE.test(path);
}

/** Old binary workbooks: a different format altogether, so they are named rather than read. */
export function isLegacyWorkbook(path: string): boolean {
  return /\.xls$/i.test(path);
}

// ---------------------------------------------------------------------------------
// Which cells are SQL

/** Comments a query may open with, before its first keyword. */
function stripLeadingComments(text: string): string {
  let t = text.trimStart();
  for (;;) {
    if (t.startsWith('--')) t = t.slice(t.indexOf('\n') + 1 || t.length).trimStart();
    else if (t.startsWith('/*') && t.includes('*/')) t = t.slice(t.indexOf('*/') + 2).trimStart();
    else return t;
  }
}

const MODIFIERS =
  '(?:(?:or\\s+replace|or\\s+alter|if\\s+not\\s+exists|if\\s+exists|temp|temporary|global|local|unique|clustered|nonclustered|materialized|external|transient|secure|recursive|volatile|multiset)\\s+)*';
const OBJECT = '(?:table|view|index|function|procedure|proc|schema|database|sequence|trigger|type|stage|stream|task|role|user)\\b';

/**
 * Each statement keyword, with the shape that follows it in SQL. A cell has to match
 * one, so prose that happens to start with a keyword — "Select the region below",
 * "Update the figures monthly", "Create a table of results" — is left alone.
 */
const SQL_SHAPES: RegExp[] = [
  /^select\b[\s\S]*\bfrom\b/i,
  /^select\s+(?:\d|'|\*|@@?\w|(?:top|distinct)\b|[\w.]+\s*\(|current_\w+|sysdate\b|now\s*\()/i,
  /^with\s+(?:recursive\s+)?[\w"`[\]]+\s*(?:\([^)]*\)\s*)?as\s*(?:(?:not\s+)?materialized\s*)?\(/i,
  /^insert\s+(?:into|overwrite|ignore|all|first)\b/i,
  /^update\s+[\w."`[\]]+(?:\s+(?:as\s+)?\w+)?\s+set\s/i,
  /^delete\s+(?:from\b|top\s*\(|[\w."`[\]]+\s+from\b)/i,
  /^merge\s+(?:into\s+)?[\w."`[\]]+[\s\S]*\busing\b/i,
  new RegExp(`^(?:create|alter|drop)\\s+${MODIFIERS}${OBJECT}`, 'i'),
  /^truncate\s+table\b/i,
  /^(?:exec|execute)\s+(?:@\w+\s*=\s*)?(?:sp_|xp_|\[|[\w]+\.[\w[])/i,
  /^call\s+[\w.]+\s*\(/i,
  /^declare\s+@\w+/i,
  /^(?:grant|revoke)\s+[\w ,]+\s+on\s+/i,
  /^explain\s+(?:analyze\s+|\([^)]*\)\s*)?(?:select|with|insert|update|delete)\b/i,
];

/**
 * Instructions read like SQL more often than expected — "Select the rows from the
 * table below". Words like these, with none of SQL's punctuation, mean prose.
 */
const PROSE_WORDS = /\b(?:the|your|you|please|our|this|these|those|which|should|will)\b/i;
const SQL_PUNCTUATION = /[;=*(),'"<>]/;

/** True when a cell's text is a SQL statement, not prose that starts like one. */
export function isSqlCell(text: string): boolean {
  if (text.length < 8) return false;
  const t = stripLeadingComments(text);
  if (!SQL_SHAPES.some((shape) => shape.test(t))) return false;
  return SQL_PUNCTUATION.test(t) || !PROSE_WORDS.test(t);
}

// ---------------------------------------------------------------------------------
// Cell names

function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A header worth showing: short text in row 1 that is not itself a query. */
function headerName(text: string | undefined): string | undefined {
  const t = text?.trim();
  return t && t.length <= 40 && !t.includes('\n') && !isSqlCell(t) ? t : undefined;
}

const withHeader = (ref: string, header: string | undefined) => (header ? `${ref} (${header})` : ref);

// ---------------------------------------------------------------------------------
// CSV

interface Field {
  row: number;
  col: number;
  value: string;
  /** Where the field's raw text sits in the file, quotes included. */
  start: number;
  end: number;
}

/** The delimiter: tab for .tsv, otherwise whichever of , ; tab | the first line uses most. */
export function detectDelimiter(text: string, path = ''): string {
  if (/\.tsv$/i.test(path)) return '\t';
  const first = text.slice(0, text.search(/\r?\n|$/));
  const counts = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

/** RFC 4180 fields with their offsets, so a changed field can be spliced in place. */
export function parseCsv(text: string, delimiter: string): Field[] {
  const fields: Field[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row = 0;
  let col = 0;
  const n = text.length;
  while (i <= n) {
    const start = i;
    let value = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) {
          value += text.slice(i);
          i = n;
          break;
        }
        value += text.slice(i, q);
        if (text[q + 1] === '"') {
          value += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      // Anything between the closing quote and the delimiter is kept, as spreadsheets do.
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') value += text[i++];
    } else {
      while (i < n && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') i++;
      value = text.slice(start, i);
    }
    fields.push({ row, col, value, start, end: i });
    if (i >= n) break;
    if (text[i] === delimiter) {
      i++;
      col++;
    } else {
      i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
      if (i >= n) break;
      row++;
      col = 0;
    }
  }
  return fields;
}

const quoteCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;

function decodeText(bytes: Uint8Array): { text: string; legacy: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), legacy: false };
  } catch {
    return { text: decodeLegacyText(bytes).text, legacy: true };
  }
}

export function readCsv(bytes: Uint8Array, path: string): SheetDoc {
  const { text, legacy } = decodeText(bytes);
  const delimiter = detectDelimiter(text, path);
  const fields = parseCsv(text, delimiter);
  const headers = new Map(fields.filter((f) => f.row === 0).map((f) => [f.col, headerName(f.value)]));
  const sql = fields.filter((f) => isSqlCell(f.value));
  const byRef = new Map(sql.map((f) => [`${columnLetters(f.col)}${f.row + 1}`, f]));
  return {
    kind: 'csv',
    bytes,
    cells: [...byRef].map(([ref, f]) => ({
      ref,
      label: withHeader(ref, f.row > 0 ? headers.get(f.col) : undefined),
      text: f.value.replace(/\r\n?/g, '\n'),
    })),
    write(changes) {
      const edits = [...changes]
        .map(([ref, value]) => ({ field: byRef.get(ref), value }))
        .filter((e): e is { field: Field; value: string } => !!e.field)
        .sort((a, b) => b.field.start - a.field.start);
      let out = text;
      for (const { field, value } of edits) out = out.slice(0, field.start) + quoteCsv(value) + out.slice(field.end);
      // A file that was not UTF-8 comes back as UTF-8 with a byte-order mark, so Excel
      // still opens it with the right characters.
      const bom = legacy && out.charCodeAt(0) !== 0xfeff ? '﻿' : '';
      return strToU8(bom + out);
    },
  };
}

// ---------------------------------------------------------------------------------
// Excel

const XML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text to a string, including OOXML's `_x000D_` escapes for characters XML cannot hold. */
function xmlText(raw: string): string {
  return raw
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (XML_ENTITY[e] ?? m),
    )
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function escapeXml(value: string): string {
  return value
    .replace(/_(x[0-9a-f]{4})_/gi, '_x005F_$1_')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => `_x${c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}_`);
}

/** All the `<t>` text in an element, leaving out phonetic guides (`<rPh>`). */
function runText(xml: string): string {
  const plain = xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, '');
  let out = '';
  for (const m of plain.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) out += xmlText(m[1] ?? '');
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
}

/** Resolve a relationship target against the folder of the part that refers to it. */
function resolvePart(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

interface XlsxCell {
  ref: string;
  sheetPart: string;
  /** The whole `<c …>…</c>` element's span in the sheet XML. */
  start: number;
  end: number;
  attrs: string;
  prefix: string;
}

const decoder = new TextDecoder();

export function readXlsx(bytes: Uint8Array): SheetDoc {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('This is not a readable Excel workbook. If it is password-protected, save an unprotected copy first.');
  }
  const part = (name: string) => (entries[name] ? decoder.decode(entries[name]) : undefined);
  const workbook = part('xl/workbook.xml');
  if (!workbook) throw new Error('This is not an Excel workbook (.xlsx): it has no xl/workbook.xml.');

  const rels = new Map<string, string>();
  for (const m of (part('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, 'Id');
    const target = attr(m[1]!, 'Target');
    if (id && target) rels.set(id, resolvePart('xl/workbook.xml', target));
  }

  const shared: string[] = [];
  for (const m of (part('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    shared.push(runText(m[1] ?? ''));
  }

  const sheets: { name: string; part: string }[] = [];
  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = xmlText(attr(m[1]!, 'name') ?? '');
    const id = /(?:^|\s)(?:\w+:)?id="([^"]*)"/.exec(m[1]!)?.[1];
    const target = id ? rels.get(id) : undefined;
    if (target && entries[target]) sheets.push({ name, part: target });
  }

  const cells: SheetCell[] = [];
  const located = new Map<string, XlsxCell>();
  const sheetXml = new Map<string, string>();

  for (const sheet of sheets) {
    const xml = part(sheet.part)!;
    sheetXml.set(sheet.part, xml);
    const data = /<(\w+:)?sheetData\b[^>]*>/.exec(xml);
    if (!data) continue;
    const dataStart = data.index + data[0].length;
    const dataEnd = xml.indexOf('sheetData>', dataStart);
    const body = xml.slice(dataStart, dataEnd < 0 ? xml.length : dataEnd);
    const headers = new Map<number, string | undefined>();
    const found: { col: number; row: number; cell: XlsxCell; text: string }[] = [];

    let rowNumber = 0;
    for (const r of body.matchAll(/<(\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1row>)/g)) {
      rowNumber = Number(attr(r[2]!, 'r')) || rowNumber + 1;
      const content = r[3];
      if (!content) continue;
      const contentStart = dataStart + r.index! + r[0].indexOf('>') + 1;
      let colNumber = -1;
      for (const c of content.matchAll(/<(\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1c>)/g)) {
        const attrs = c[2]!;
        const refAttr = attr(attrs, 'r');
        const refMatch = refAttr ? /^([A-Z]+)(\d+)$/i.exec(refAttr) : null;
        colNumber = refMatch ? columnIndex(refMatch[1]!) : colNumber + 1;
        const inner = c[3] ?? '';
        // A formula's text is computed by Excel; rewriting it would replace the formula.
        if (/<(\w+:)?f\b/.test(inner)) continue;
        const type = attr(attrs, 't');
        let text: string | undefined;
        if (type === 's') text = shared[Number(/<(?:\w+:)?v>([^<]*)</.exec(inner)?.[1])];
        else if (type === 'inlineStr') text = runText(/<(\w+:)?is\b[\s\S]*?<\/\1is>/.exec(inner)?.[0] ?? '');
        if (text === undefined) continue;
        text = text.replace(/\r\n?/g, '\n');
        if (rowNumber === 1) headers.set(colNumber, headerName(text));
        if (!isSqlCell(text)) continue;
        const start = contentStart + c.index!;
        found.push({
          col: colNumber,
          row: rowNumber,
          text,
          cell: { ref: `${columnLetters(colNumber)}${rowNumber}`, sheetPart: sheet.part, start, end: start + c[0].length, attrs, prefix: c[1] ?? '' },
        });
      }
    }
    for (const f of found) {
      const ref = `${sheet.name}!${f.cell.ref}`;
      located.set(ref, f.cell);
      cells.push({ ref, label: withHeader(ref, f.row > 1 ? headers.get(f.col) : undefined), text: f.text });
    }
  }

  return {
    kind: 'xlsx',
    bytes,
    cells,
    write(changes) {
      const bySheet = new Map<string, { cell: XlsxCell; value: string }[]>();
      for (const [ref, value] of changes) {
        const cell = located.get(ref);
        if (!cell) continue;
        bySheet.set(cell.sheetPart, [...(bySheet.get(cell.sheetPart) ?? []), { cell, value }]);
      }
      const out: Zippable = {};
      for (const [name, data] of Object.entries(entries)) out[name] = data;
      for (const [sheetPart, edits] of bySheet) {
        let xml = sheetXml.get(sheetPart)!;
        for (const { cell, value } of edits.sort((a, b) => b.cell.start - a.cell.start)) {
          // The cell becomes an inline string: the shared-string table is left as it
          // was, and the cell keeps its style (s="…"), so wrapping and fonts stay.
          const attrs = cell.attrs.replace(/\s+t="[^"]*"/, '').replace(/\s*\/$/, '');
          const p = cell.prefix;
          const element = `<${p}c${attrs} t="inlineStr"><${p}is><${p}t xml:space="preserve">${escapeXml(value)}</${p}t></${p}is></${p}c>`;
          xml = xml.slice(0, cell.start) + element + xml.slice(cell.end);
        }
        out[sheetPart] = strToU8(xml);
      }
      return zipSync(out, { level: 6 });
    },
  };
}

export function readSheet(bytes: Uint8Array, path: string): SheetDoc {
  return /\.(xlsx|xlsm)$/i.test(path) ? readXlsx(bytes) : readCsv(bytes, path);
}
