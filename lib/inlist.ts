import type { Dialect } from './dialects';
import {
  isNullLiteral,
  isNumericLiteral,
  hasSignificantLeadingZero,
  quoteIdentifier,
  renderValue,
  type ValueMode,
} from './escape';

export const MAX_IN_VALUES = 100_000;

/* ------------------------------------------------------------------ parsing */

export type Separator = 'newline' | 'comma' | 'tab' | 'whitespace' | 'newlineAndComma';

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

const DELIMITERS: Record<Separator, { chars: Set<string>; splitNewlines: boolean }> = {
  newline: { chars: new Set(), splitNewlines: true },
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
  const { chars, splitNewlines } = DELIMITERS[separator];
  const text = input.replace(/\r\n/g, '\n');
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let fieldStarted = false;

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
      values.push(current);
      current = '';
      fieldStarted = false;
      continue;
    }

    if (!/\s/.test(ch)) fieldStarted = true;
    current += ch;
  }
  values.push(current);
  return values;
}

/* ----------------------------------------------------------------- cleanup */

export interface CleanupOptions {
  trim: boolean;
  dropBlank: boolean;
  dedupe: boolean;
  caseMode: 'preserve' | 'lower' | 'upper';
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  trim: false,
  dropBlank: false,
  dedupe: false,
  caseMode: 'preserve',
};

export interface CleanupReport {
  values: string[];
  inputCount: number;
  blanksRemoved: number;
  duplicatesRemoved: number;
  trimmed: number;
}

export function applyCleanup(values: string[], options: CleanupOptions): CleanupReport {
  const inputCount = values.length;
  let trimmed = 0;
  let out = values;

  if (options.trim) {
    out = out.map((v) => {
      const t = v.trim();
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

  return { values: out, inputCount, blanksRemoved, duplicatesRemoved, trimmed };
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

  if (valueMode === 'auto') {
    const numeric = values.filter((v) => isNumericLiteral(v)).length;
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

/**
 * Turn an existing IN list back into plain values, one per line.
 *
 * Accepts a bare list, `IN (...)`, or a full `WHERE col IN (...)`, and unescapes
 * string literals according to the dialect's rules.
 */
export function parseInList(input: string, dialect: Dialect): string[] {
  let text = input.trim();

  const open = text.indexOf('(');
  if (open !== -1) {
    const close = text.lastIndexOf(')');
    if (close > open) text = text.slice(open + 1, close);
  }

  const values: string[] = [];
  let current = '';
  let inString = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (dialect.backslashIsEscape && ch === '\\') {
        const next = text[i + 1];
        if (next !== undefined) {
          current += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i++;
          continue;
        }
      }
      if (ch === "'") {
        if (text[i + 1] === "'") {
          current += "'";
          i++;
        } else {
          inString = false;
        }
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === "'") {
      inString = true;
      started = true;
      continue;
    }
    if (ch === ',') {
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
