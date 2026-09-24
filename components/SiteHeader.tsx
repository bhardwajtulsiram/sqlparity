'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { OverviewIcon, ParityMark, SearchIcon } from '@/components/icons';
import { TOOLS } from '@/components/tools';
import { useExternalRequestCount } from '@/lib/network';

const TABS = [{ href: '/', label: 'Overview', Icon: OverviewIcon }, ...TOOLS];

/**
 * Two tiers: identity and the privacy reading on top, the tools as tabs underneath.
 *
 * Seven tools and a wordmark do not fit one row at laptop widths without the labels
 * shrinking to guesswork, and the tabs are the thing people use most — so they get a
 * row of their own, which can scroll sideways on a phone rather than wrap into three.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const palette = useCommandPalette();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-card)] bg-[var(--surface-card)]/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="SQLParity home">
          <ParityMark className="size-7" />
          <span className="text-[17px] font-semibold tracking-tight">SQLParity</span>
        </Link>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            aria-label="Go to a tool"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] pr-1.5 pl-2.5 text-[13px] text-ink-500 shadow-[var(--shadow-control)] transition-colors hover:border-[var(--border-strong)] hover:text-ink-700 sm:w-56 dark:text-ink-400 dark:hover:text-ink-200"
          >
            <SearchIcon className="size-4 shrink-0" />
            <span className="hidden sm:inline">Go to a tool</span>
            <kbd className="ml-auto hidden rounded-md border border-[var(--border-card)] bg-[var(--surface-header)] px-1.5 font-mono text-[11px] leading-5 sm:block">
              {mac ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>

          <PrivacyReading />
        </div>
      </div>

      <nav aria-label="Tools" className="mx-auto w-full max-w-7xl px-2 sm:px-4">
        <ul className="-mb-px flex overflow-x-auto [scrollbar-width:none]">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <li key={tab.href} className="shrink-0">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex h-11 items-center gap-2 px-3 text-[13.5px] font-medium transition-colors ${
                    active
                      ? 'text-ink-900 dark:text-white'
                      : 'text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100'
                  }`}
                >
                  <tab.Icon
                    className={`size-4 ${
                      active
                        ? 'text-accent-600 dark:text-accent-400'
                        : 'text-ink-400 group-hover:text-ink-600 dark:text-ink-500 dark:group-hover:text-ink-300'
                    }`}
                  />
                  {tab.label}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full transition-colors ${
                      active ? 'bg-accent-600 dark:bg-accent-400' : 'group-hover:bg-ink-300 dark:group-hover:bg-ink-700'
                    }`}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </header>
  );
}

/**
 * The privacy claim as a reading rather than a slogan: how many requests this page
 * has sent to another server, counted by the browser, updated live.
 */
function PrivacyReading() {
  const external = useExternalRequestCount();
  const clean = external === null || external === 0;

  return (
    <span
      className={`hidden h-9 items-center gap-2 rounded-lg border px-3 text-[12.5px] md:flex ${
        clean
          ? 'border-[color-mix(in_oklab,var(--signal)_30%,transparent)] bg-[var(--signal-soft)]'
          : 'border-red-500/40 bg-red-500/10'
      }`}
      title="Counted from this page's own network timeline, live"
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
