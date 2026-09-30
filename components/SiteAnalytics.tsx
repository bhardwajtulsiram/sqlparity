'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

/**
 * Vercel Web Analytics: counts page views, and nothing a user types.
 *
 * It fits inside the privacy claim because of where it sends. On Vercel both the
 * script (/_vercel/insights/script.js) and its beacon are served from this site's own
 * domain, so they pass `connect-src 'self'` untouched — the CSP did not need loosening,
 * and the header's "sent to another server" count stays at zero. It sets no cookies.
 *
 * Two guards keep it that way:
 *
 *   Production only.  In development the package loads a debug script from
 *                     va.vercel-scripts.com. The CSP blocks that, correctly, and the
 *                     console fills with violations; rendering nothing locally is
 *                     cleaner than punching a hole in the policy for it.
 *
 *   Path only.        No tool puts user data in a URL today — the diff-to-generator
 *                     handoff goes through sessionStorage. Stripping the query string
 *                     and fragment anyway means a future feature that does cannot leak
 *                     a column name into a visitor report by accident.
 */
function pathOnly(event: BeforeSendEvent): BeforeSendEvent {
  try {
    const url = new URL(event.url);
    url.search = '';
    url.hash = '';
    return { ...event, url: url.toString() };
  } catch {
    return event;
  }
}

export function SiteAnalytics() {
  if (process.env.NODE_ENV !== 'production') return null;
  return <Analytics beforeSend={pathOnly} />;
}
