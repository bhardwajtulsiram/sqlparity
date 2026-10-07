'use client';

import { useExternalRequestCount } from '@/lib/network';

/** The site's own pages, after the Tools menu. Shared with the mobile sheet. */
export const SITE_LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/about/', label: 'About' },
];

/**
 * The privacy claim as a reading rather than a slogan: how many requests this page
 * has sent to another server, counted by the browser, updated live. Shown in the
 * header from wide screens up, and always in the mobile sheet.
 */
export function PrivacyReading({ always = false }: { always?: boolean }) {
  const external = useExternalRequestCount();
  const clean = external === null || external === 0;

  return (
    <span
      className={`${always ? 'flex' : 'hidden xl:flex'} h-9 items-center gap-2 rounded-lg border px-3 text-[12.5px] whitespace-nowrap ${
        clean
          ? 'border-[color-mix(in_oklab,var(--signal)_30%,transparent)] bg-[var(--signal-soft)]'
          : 'border-red-500/40 bg-red-500/10'
      }`}
      title="Requests this page has sent to any other server, counted from the browser's own network timeline"
    >
      <span
        aria-hidden="true"
        className={`live-dot size-1.5 rounded-full ${clean ? 'text-[var(--signal)]' : 'text-red-500'}`}
        style={{ background: 'currentColor' }}
      />
      <span className="text-ink-600 dark:text-ink-300">Runs in this tab</span>
      {external !== null && (
        <span
          className={`border-l pl-2 font-mono font-semibold ${
            clean
              ? 'border-[color-mix(in_oklab,var(--signal)_30%,transparent)] text-[color-mix(in_oklab,var(--signal)_80%,black)] dark:text-[var(--signal)]'
              : 'border-red-500/40 text-red-700 dark:text-red-400'
          }`}
        >
          {external} sent
        </span>
      )}
    </span>
  );
}

/**
 * The same reading as a card, for the home page hero: the real count from this page,
 * not a picture of one.
 */
export function RequestCountCard({ className = '' }: { className?: string }) {
  const external = useExternalRequestCount();
  const clean = external === null || external === 0;
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-[var(--surface-card)] px-3.5 py-2.5 shadow-[var(--shadow-card)] ${
        clean ? 'border-[color-mix(in_oklab,var(--signal)_35%,transparent)]' : 'border-red-500/50'
      } ${className}`}
      title="Counted live from this page's own network timeline"
    >
      <span
        aria-hidden="true"
        className={`live-dot size-2 rounded-full ${clean ? 'text-[var(--signal)]' : 'text-red-500'}`}
        style={{ background: 'currentColor' }}
      />
      <span className="text-[12.5px] leading-tight text-ink-600 dark:text-ink-300">
        Requests to
        <br />
        other servers
      </span>
      <span
        className={`font-mono text-[22px] font-semibold ${
          clean ? 'text-[color-mix(in_oklab,var(--signal)_80%,black)] dark:text-[var(--signal)]' : 'text-red-600'
        }`}
      >
        {external ?? 0}
      </span>
    </div>
  );
}
