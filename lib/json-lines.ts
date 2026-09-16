/**
 * Which line each key of a JSON document sits on.
 *
 * `JSON.parse` throws position away, so a field parsed out of a mapping cannot say
 * where it came from — which is what a diff needs in order to point at the line. This
 * is a scanner, not a parser: it only tracks strings, depth and whether the string it
 * just read was a key, which is enough to rebuild each key's path and remember its
 * line. Anything malformed simply yields fewer entries; validity is `JSON.parse`'s job
 * and it has already been asked by the time this runs.
 *
 * Paths are dotted, so `mappings.properties.address` — the same shape the caller
 * builds while walking the parsed object, so the two can be matched up.
 */
export function keyLines(text: string): Map<string, number> {
  const lines = new Map<string, number>();
  const stack: string[] = [];
  /** Array depth inside the current object, so `[{…}]` does not look like a key path. */
  let line = 1;
  let i = 0;
  // The key most recently read at this depth, waiting for its value.
  const pending: (string | null)[] = [];

  const path = () => stack.filter((s) => s !== '').join('.');

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }

    if (ch === '"') {
      const start = i;
      const startLine = line;
      i++;
      let value = '';
      while (i < text.length) {
        if (text[i] === '\\') {
          value += text[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (text[i] === '"') break;
        if (text[i] === '\n') line++;
        value += text[i];
        i++;
      }
      i++; // closing quote

      // A string followed by a colon is a key.
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === ':') {
        pending[stack.length] = value;
        const full = path() ? `${path()}.${value}` : value;
        // First occurrence wins: a repeated key is invalid JSON anyway, and the first
        // is the one a reader's eye lands on.
        if (!lines.has(full)) lines.set(full, startLine);
      }
      if (start === i) i++; // never stall on a malformed string
      continue;
    }

    if (ch === '{') {
      stack.push(pending[stack.length] ?? '');
      pending[stack.length] = null;
      i++;
      continue;
    }

    if (ch === '}') {
      stack.pop();
      i++;
      continue;
    }

    // Arrays do not contribute a path segment; their contents are values.
    i++;
  }

  return lines;
}
