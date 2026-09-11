'use client';

/**
 * One-shot state passed between tools without a backend.
 *
 * The schema diff tool wants to send its "changed columns" straight into the bulk
 * generator's field box. There is no server to route through, so sessionStorage is
 * used as a mailbox: written just before navigating away, read and immediately
 * cleared on the next page's first render. sessionStorage rather than localStorage
 * because this is a single delivery, not a saved preference — it should not resurrect
 * days later in an unrelated tab.
 */

const FIELDS_KEY = 'sqlparity:handoff.fields';

export function sendFieldsHandoff(grid: string): void {
  try {
    window.sessionStorage.setItem(FIELDS_KEY, grid);
  } catch {
    // Storage blocked (private browsing). The navigation still happens; the
    // destination simply starts empty instead of pre-filled.
  }
}

/** Reads and clears in one call, so a later remount never replays the same handoff. */
export function takeFieldsHandoff(): string | null {
  try {
    const value = window.sessionStorage.getItem(FIELDS_KEY);
    if (value !== null) window.sessionStorage.removeItem(FIELDS_KEY);
    return value;
  } catch {
    return null;
  }
}
