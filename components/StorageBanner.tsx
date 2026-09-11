'use client';

import { useStorageAvailable } from '@/lib/settings';

/**
 * Settings are kept in localStorage. When the browser refuses it — a private window,
 * or site data blocked — say so rather than letting the user's preferences quietly
 * reset on every visit.
 */
export function StorageBanner() {
  const available = useStorageAvailable();
  if (available) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
    >
      This browser is blocking local storage, so your settings won&apos;t be saved between visits.
      Everything still works — nothing is lost until you close the tab.
    </div>
  );
}
