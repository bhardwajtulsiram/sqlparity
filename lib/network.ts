'use client';

import { useEffect, useState } from 'react';

/**
 * Counts requests this page has made to any other origin, live.
 *
 * The privacy claim is the product, and a reading is worth more than a claim. This
 * watches the browser's own resource timeline — including everything already loaded,
 * via `buffered` — and reports anything whose origin is not this one. It is a real
 * measurement: were the number ever not zero, it would say so.
 *
 * Null until measured, and stays null in a browser without resource timing, so a
 * caller never prints a zero that nothing actually counted.
 */
export function useExternalRequestCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;

    const isExternal = (entry: PerformanceEntry) => {
      try {
        return new URL(entry.name, window.location.href).origin !== window.location.origin;
      } catch {
        return false;
      }
    };

    const observer = new PerformanceObserver((list) => {
      const external = list.getEntries().filter(isExternal).length;
      if (external > 0) setCount((n) => (n ?? 0) + external);
    });

    try {
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      return;
    }

    setCount((n) => n ?? 0);
    return () => observer.disconnect();
  }, []);

  return count;
}
