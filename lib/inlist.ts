import type { Dialect } from './dialects';
import {
  isNullLiteral,
  isNumericLiteral,
  isPlainNumber,
  hasSignificantLeadingZero,
  quoteIdentifier,
  renderValue,
  type ValueMode,
} from './escape';
import { isInLiteral, scan } from './tokenize';

export const MAX_IN_VALUES = 100_000;

/* ------------------------------------------------------------------ parsing */

export type Separator =
  | 'newline'
  | 'comma'
  | 'tab'
  | 'whitespace'
  | 'newlineAndComma'
  | 'firstColumn';

export interface Detection {
  separator: Separator;
  /** False when the input could reasonably be read more than one way. */
  confident: boolean;
  /** Other readings worth offering the user, most likely first. */
  alternatives: Separator[];
  reason: string;
}

export const SEPARATOR_LABELS: Record<Separator, string> = {
  newline: 'One value per line',
  comma: 'Comma separated',
  tab: 'Tab separated',
  whitespace: 'Whitespace separated',
  newlineAndComma: 'Lines and commas',
  firstColumn: 'First column only',
};

/**
 * Work out how the pasted text is separated.
 *
 * The interesting case is text that has both newlines and commas. That is genuinely
 * ambiguous — `Acme, Inc.` on its own line is one value containing a comma, while
 * `a,b,c` on its own line is three. We do not guess silently; `confident: false`
 * tells the UI to ask.
 */
export function detectSeparator(input: string): Detection {
  const text = input.replace(/\r\n/g, '\n');
  const hasNewline = text.includes('\n');
  const hasTab = text.includes('\t');
  const hasComma = text.includes(',');

  if (hasTab) {
    // Several rows of the same number of tab-separated cells is a block copied out of
    // a spreadsheet. Flattening every cell into one list would mix the columns — IDs
    // and names in one IN clause — so the first column is read, and the rest offered.
    const rows = text.split('\n').filter((l) => l.trim() !== '');
    const widths = rows.map((l) => l.split('\t').length);
    if (rows.length >= 2 && widths[0]! >= 2 && widths.every((w) => w === widths[0])) {
      return {
        separator: 'firstColumn',
        confident: false,
        alternatives: ['tab'],
        reason: `This looks like ${widths[0]} columns copied from a spreadsheet, so only the first column is read. Choose "Tab separated" to use every cell.`,
      };
    }
    return {
      separator: 'tab',
      confident: true,
      alternatives: ['newline'],
      reason: 'Tabs found — reading as tab separated (typical of a spreadsheet paste).',
    };
  }

  if (hasNewline && hasComma) {
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    const withCommas = lines.filter((l) => l.includes(',')).length;
    const allLinesHaveCommas = withCommas === lines.length;
    // Every line carrying commas looks like rows of values; only some lines carrying
    // them looks more like commas that belong inside the values themselves.
    return {
      separator: allLinesHaveCommas ? 'newlineAndComma' : 'newline',
      confident: false,
      alternatives: allLinesHaveCommas ? ['newline'] : ['newlineAndComma'],
      reason: allLinesHaveCommas
        ? `All ${lines.length} lines contain commas, so commas look like separators. If your values contain commas, switch to one value per line.`
        : `${withCommas} of ${lines.length} lines contain commas, so the commas may be part of the values. Check before generating.`,
    };
  }

  if (hasNewline) {
    return {
      separator: 'newline',
      confident: true,
      alternatives: [],
      reason: 'One value per line.',
    };
  }

  if (hasComma) {
    return {
      separator: 'comma',
      confident: true,
      alternatives: ['whitespace'],
      reason: 'Comma separated.',
    };
  }

  if (/\s/.test(text.trim())) {
    return {
      separator: 'whitespace',
      confident: false,
      alternatives: ['newline'],
      reason: 'No commas, tabs or line breaks found — splitting on spaces.',
    };
  }

  return { separator: 'newline', confident: true, alternatives: [], reason: 'Single value.' };
}

const DELIMITERS: Record<
  Separator,
  { chars: Set<string>; splitNewlines: boolean; firstOnly?: boolean }
> = {
  newline: { chars: new Set(), splitNewlines: true },
  firstColumn: { chars: new Set(['\t']), splitNewlines: true, firstOnly: true },
  comma: { chars: new Set([',']), splitNewlines: false },
  tab: { chars: new Set(['\t']), splitNewlines: true },
  whitespace: { chars: new Set([' ', '\t']), splitNewlines: true },
  newlineAndComma: { chars: new Set([',']), splitNewlines: true },
};

/**
 * Split pasted text into values, honouring RFC 4180 double-quoted fields so that a
 * value like `"Acme, Inc."` survives comma splitting intact. Quotes that do not open
 * a field are left alone, so `5" pipe` is not mangled.
 */
export function splitValues(input: string, separator: Separator): string[] {
  const { chars, splitNewlines, firstOnly } = DELIMITERS[separator];
  // The line break a spreadsheet copy always ends with is not an empty last value.
  const text = input.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let fieldStarted = false;
  /** Which cell of the row we are in, for reading only the first column. */
  let cell = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    // A double quote only opens a quoted field at the very start of that field.
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }

    const isNewline = ch === '\n';
    if ((isNewline && splitNewlines) || (!isNewline && chars.has(ch))) {
      if (!firstOnly || cell === 0) values.push(current);
      cell = isNewline ? 0 : cell + 1;
      current = '';
      fieldStarted = false;
      continue;
    }

    if (!/\s/.test(ch)) fieldStarted = true;
    current += ch;
  }
  if (!firstOnly || cell === 0) values.push(current);
  return values;
}

/**
 * The first line, when it is a column heading rather than a value.
 *
 * Nearly every copy out of a spreadsheet brings its header row along, and
 * `'customer_id'` in an IN list matches nothing and hides among a thousand real
 * values. The tests are about shape, not vocabulary: a word over a column of numbers,
 * a word over a column of emails, or a label with a space or underscore over values
 * that have neither.
 */
export function headerOf(values: string[]): string | undefined {
  const cells = values.map((v) => v.trim()).filter((v) => v !== '');
  if (cells.length < 3) return undefined;
  const [first, ...rest] = cells as [string, ...string[]];
  if (first.length > 40 || isNumericLiteral(first)) return undefined;
  if (!/^[A-Za-z][A-Za-z0-9 _#.-]*$/.test(first)) return undefined;
  if (rest.some((v) => v.toLowerCase() === first.toLowerCase())) return undefined;

  const share = (test: (v: string) => boolean) => rest.filter(test).length / rest.length;
  if (share((v) => /^[+-]?\d/.test(v)) >= 0.9) return first;
  if (!/\d/.test(first) && share((v) => /\d/.test(v)) >= 0.9) return first;
  if (!first.includes('@') && share((v) => v.includes('@')) >= 0.9) return first;
  if (/[ _]/.test(first) && /(?:^|[ _])(?:id|name|code|email|number|no|key|sku|zip|phone)$/i.test(first)) {
    return first;
  }
  return undefined;
}

/** Characters that are invisible in a text box but make a value match nothing. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00A0]/;
const EDGE_WHITESPACE = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g;

/* ----------------------------------------------------------------- cleanup */

export interface CleanupOptions {
  trim: boolean;
  dropBlank: boolean;
  dedupe: boolean;
  caseMode: 'preserve' | 'lower' | 'upper';
  /** Leave out a first line that is a column heading. Unset in older saved settings, read as on. */
  dropHeader?: boolean;
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  trim: false,
  dropBlank: false,
  dedupe: false,
  caseMode: 'preserve',
  dropHeader: true,
};

export interface CleanupReport {
  values: string[];
  inputCount: number;
  blanksRemoved: number;
  duplicatesRemoved: number;
  trimmed: number;
  /** The heading that was left out, when one was. */
  header?: string;
}

export function applyCleanup(values: string[], options: CleanupOptions): CleanupReport {
  const inputCount = values.length;
  let trimmed = 0;
  let out = values;

  let header: string | undefined;
  if (options.dropHeader !== false) {
    header = headerOf(values);
    if (header !== undefined) {
      const at = values.findIndex((v) => v.trim() !== '');
      out = [...values.slice(0, at), ...values.slice(at + 1)];
    }
  }

  if (options.trim) {
    out = out.map((v) => {
      // Zero-width spaces from web pages are whitespace for this purpose, though
      // String.prototype.trim does not think so.
      const t = v.replace(EDGE_WHITESPACE, '');
      if (t !== v) trimmed++;
      return t;
    });
  }

  let blanksRemoved = 0;
  if (options.dropBlank) {
    const before = out.length;
    out = out.filter((v) => v.trim() !== '');
    blanksRemoved = before - out.length;
  }

  if (options.caseMode !== 'preserve') {
    out = out.map((v) => (options.caseMode === 'lower' ? v.toLowerCase() : v.toUpperCase()));
  }

  let duplicatesRemoved = 0;
  if (options.dedupe) {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const v of out) {
      if (seen.has(v)) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(v);
      deduped.push(v);
    }
    out = deduped;
  }

  return {
    values: out,
    inputCount,
    blanksRemoved,
    duplicatesRemoved,
    trimmed,
    ...(header !== undefined ? { header } : {}),
  };
}

/* ------------------------------------------------------------------- build */

export type OutputShape = 'bare' | 'in' | 'where';

export interface BuildOptions {
  dialect: Dialect;
  valueMode: ValueMode;
  shape: OutputShape;
  columnName: string;
  /** Split into several lists of at most this many values. 0 disables chunking. */
  chunkSize: number;
  /** Line-wrap after this many values. 0 disables wrapping. */
  wrapAt: number;
}

export const DEFAULT_BUILD: Omit<BuildOptions, 'dialect'> = {
  valueMode: 'auto',
  shape: 'in',
  columnName: 'column_name',
  chunkSize: 0,
  wrapAt: 20,
};

export interface Warning {
  level: 'warn' | 'info';
  message: string;
}

/** "1 value is" / "3 values are" — keeps the noun and its verb in agreement. */
function plural(count: number, singular: string, pluralForm: string, verb: [string, string]) {
  return `${count} ${count === 1 ? singular : pluralForm} ${count === 1 ? verb[0] : verb[1]}`;
}

export interface BuildResult {
  output: string;
  chunks: string[];
  valueCount: number;
  warnings: Warning[];
}

function renderChunk(values: string[], options: BuildOptions): string {
  const { dialect, valueMode, wrapAt } = options;
  const rendered = values.map((v) => renderValue(v, dialect, valueMode));

  let body: string;
  if (wrapAt > 0 && rendered.length > wrapAt) {
    const lines: string[] = [];
    for (let i = 0; i < rendered.length; i += wrapAt) {
      lines.push('  ' + rendered.slice(i, i + wrapAt).join(', '));
    }
    body = '\n' + lines.join(',\n') + '\n';
  } else {
    body = rendered.join(', ');
  }

  switch (options.shape) {
    case 'bare':
      return body.trim();
    case 'in':
      return `IN (${body})`;
    case 'where':
      return `WHERE ${quoteIdentifier(options.columnName, dialect)} IN (${body})`;
  }
}

export function buildInList(values: string[], options: BuildOptions): BuildResult {
  const warnings: Warning[] = [];
  const { dialect, valueMode, chunkSize } = options;

  if (values.length === 0) {
    return { output: '', chunks: [], valueCount: 0, warnings };
  }

  const nulls = values.filter(isNullLiteral).length;
  if (nulls > 0) {
    warnings.push({
      level: 'warn',
      message: `${plural(nulls, 'value', 'values', ['is', 'are'])} the literal NULL. An IN list never matches NULL — use "IS NULL" separately.`,
    });
  }

  const blanks = values.filter((v) => v.trim() === '').length;
  if (blanks > 0) {
    warnings.push({
      level: 'warn',
      message: `${plural(blanks, 'blank value', 'blank values', ['is', 'are'])} included. Turn on "Drop blanks" to remove ${blanks === 1 ? 'it' : 'them'}.`,
    });
  }

  const invisible = values.filter((v) => INVISIBLE.test(v)).length;
  if (invisible > 0) {
    warnings.push({
      level: 'warn',
      message: `${invisible} ${invisible === 1 ? 'value contains' : 'values contain'} invisible characters — zero-width or non-breaking spaces, usually copied from a web page. A value holding one matches nothing. Turn on "Trim whitespace" to strip them from the ends.`,
    });
  }

  if (valueMode === 'auto') {
    const numeric = values.filter((v) => isPlainNumber(v)).length;
    const numberLike = values.filter((v) => isNumericLiteral(v) && !isPlainNumber(v)).length;
    if (numberLike > 0) {
      warnings.push({
        level: 'info',
        message: `${numberLike === 1 ? '1 value looks like a number but starts with + or uses' : `${numberLike} values look like numbers but start with + or use`} an exponent (like +14155552671 or 1E5), so ${numberLike === 1 ? 'it was' : 'they were'} quoted as text — as numbers they would become 14155552671 and 100000. Choose Numbers if they really are numbers.`,
      });
    }
    if (numeric > 0 && numeric === values.length) {
      warnings.push({
        level: 'info',
        message: `Every value looks like a number, so none is quoted. If the column holds text — IDs, zip codes, account numbers — choose Text: Athena and PostgreSQL reject a number compared with text, and MySQL quietly converts and can match the wrong rows.`,
      });
    }
    if (numeric > 0 && numeric < values.length) {
      warnings.push({
        level: 'warn',
        message: `Mixed types: ${numeric} of ${values.length} values look numeric and the rest do not. Pick String or Numeric explicitly to avoid a type-mismatch error.`,
      });
    }
    const leadingZeros = values.filter(hasSignificantLeadingZero).length;
    if (leadingZeros > 0) {
      warnings.push({
        level: 'info',
        message: `${plural(leadingZeros, 'value', 'values', ['starts', 'start'])} with a zero (e.g. "007"), so ${leadingZeros === 1 ? 'it is' : 'they are'} quoted as strings and the zeros are preserved.`,
      });
    }
  }

  if (valueMode === 'numeric') {
    const nonNumeric = values.filter((v) => !isNumericLiteral(v)).length;
    if (nonNumeric > 0) {
      warnings.push({
        level: 'warn',
        message: `${plural(nonNumeric, 'value', 'values', ['is', 'are'])} not numeric, so ${nonNumeric === 1 ? 'it has' : 'they have'} been quoted as strings instead.`,
      });
    }
  }

  const limit = dialect.maxInListSize;
  if (limit && values.length > limit && chunkSize === 0) {
    warnings.push({
      level: 'warn',
      message: `${dialect.label} allows at most ${limit} values in an IN list and you have ${values.length}. Turn on chunking to split them.`,
    });
  }

  const size = chunkSize > 0 ? chunkSize : values.length;
  const chunks: string[] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(renderChunk(values.slice(i, i + size), options));
  }

  return {
    output: chunks.join('\n\n'),
    chunks,
    valueCount: values.length,
    warnings,
  };
}

/* ----------------------------------------------------------------- reverse */

export interface ParsedInList {
  values: string[];
  /** How many IN lists the text held. Only the first one's values are returned. */
  lists: number;
}

/**
 * Turn an existing IN list back into plain values, one per line.
 *
 * Accepts a bare list, `IN (...)`, or a whole WHERE clause, and unescapes string
 * literals according to the dialect's rules. The list is found by its `IN (`, not by
 * the first bracket in the text — `WHERE lower(email) IN (…)` opens a bracket for
 * lower() first.
 */
export function parseInLists(input: string, dialect: Dialect): ParsedInList {
  const text = input.trim();
  const segments = scan(text, dialect);

  const opens: number[] = [];
  for (const m of text.matchAll(/\bIN\s*\(/gi)) {
    if (!isInLiteral(segments, m.index)) opens.push(m.index + m[0].length - 1);
  }

  const closeOf = (open: number) => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (isInLiteral(segments, i)) continue;
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) return i;
    }
    return text.length;
  };

  let body = text;
  if (opens.length > 0) {
    body = text.slice(opens[0]! + 1, closeOf(opens[0]!));
  } else {
    const open = [...text].findIndex((ch, i) => ch === '(' && !isInLiteral(segments, i));
    if (open !== -1) body = text.slice(open + 1, closeOf(open));
  }

  return { values: splitListBody(body, dialect), lists: Math.max(1, opens.length) };
}

/** Values of the first IN list in the text. */
export function parseInList(input: string, dialect: Dialect): string[] {
  return parseInLists(input, dialect).values;
}

function splitListBody(text: string, dialect: Dialect): string[] {
  const values: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (quote) {
      if (dialect.backslashIsEscape && ch === '\\') {
        const next = text[i + 1];
        if (next !== undefined) {
          current += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i++;
          continue;
        }
      }
      if (ch === quote) {
        if (text[i + 1] === quote) {
          current += quote;
          i++;
        } else {
          quote = null;
        }
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'" || (ch === '"' && dialect.doubleQuoteIsString)) {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (started || current.trim() !== '') values.push(current.trim());
      current = '';
      started = false;
      continue;
    }
    current += ch;
  }
  if (started || current.trim() !== '') values.push(current.trim());

  return values;
}
