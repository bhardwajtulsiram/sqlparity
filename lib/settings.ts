'use client';

import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'sqlparity:';

/**
 * Whether this browser will actually keep what we store.
 *
 * Private windows, cleared site data and browsers configured to block site data all
 * make this false, and some contexts throw on access rather than returning null — so
 * every read and write is guarded. The UI shows a banner when this is false rather
 * than silently losing the user's settings.
 */
export function storageAvailable(): boolean {
  try {
    const probe = `${PREFIX}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked. The banner already tells the user.
  }
}

/**
 * A piece of persisted UI state.
 *
 * Settings, templates and type maps are persisted. Pasted input and generated output
 * deliberately are not — 100,000 values would exceed the ~5 MB origin quota.
 *
 * The first render always returns `initial` so the server-rendered markup and the
 * first client render agree; the stored value is applied immediately afterwards.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setValue(read(key, initial));
    setHydrated(true);
    // `initial` is intentionally not a dependency: it is a default, not a signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        write(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set, hydrated] as const;
}

export function useStorageAvailable(): boolean {
  const [available, setAvailable] = useState(true);
  useEffect(() => setAvailable(storageAvailable()), []);
  return available;
}
