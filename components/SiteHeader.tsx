'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { ParityMark, SearchIcon } from '@/components/icons';
import { MobileMenu } from '@/components/MobileMenu';
import { PrivacyReading, SITE_LINKS } from '@/components/SiteNav';
import { ToolsMenu } from '@/components/ToolsMenu';

const GITHUB = 'https://github.com/bhardwajtulsiram/sqlparity';

/**
 * One row: identity, the Tools menu and the site's pages, then search, the privacy
 * reading and GitHub.
 *
 * Tools used to be a row of tabs of their own. At eight that row no longer fitted a
 * laptop, and every tool added would have pushed another off-screen, so they moved
 * into a single menu grouped by job. Below the desktop breakpoint the whole set
 * collapses into a sheet behind one button.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const palette = useCommandPalette();
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-card)] bg-[var(--surface-card)]/85 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="SQLParity home">
          <ParityMark className="size-8" />
          <span className="text-[17.5px] font-semibold tracking-tight">SQLParity</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
          <ToolsMenu />
          {SITE_LINKS.map((link) => {
            const active = link.href !== '/#how' && pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-9 items-center rounded-lg px-3 text-[14px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                    : 'text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/[0.06] dark:hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            aria-label="Search tools"
            aria-keyshortcuts="Control+K Meta+K"
            className="flex size-10 items-center justify-center gap-2 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] text-[13px] text-ink-500 shadow-[var(--shadow-control)] transition-colors hover:border-[var(--border-strong)] hover:text-ink-700 sm:h-9 sm:w-44 sm:justify-start sm:pr-1.5 sm:pl-2.5 xl:w-48 dark:text-ink-400 dark:hover:text-ink-200"
          >
            <SearchIcon className="size-4 shrink-0" />
            <span className="hidden sm:inline">Search tools</span>
            <kbd className="ml-auto hidden rounded-md border border-[var(--border-card)] bg-[var(--surface-header)] px-1.5 font-mono text-[11px] leading-5 sm:block">
              {mac ? '⌘' : 'Ctrl'} K
            </kbd>
          </button>

          <PrivacyReading />

          <a
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="SQLParity on GitHub"
            title="View on GitHub"
            className="hidden size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900 sm:flex dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            <svg className="size-[19px] fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.2 6.8 9.5.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.8 1A9.6 9.6 0 0 1 12 6.8c.9 0 1.7.1 2.5.3 1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.6.6.7 1 1.6 1 2.7 0 3.8-2.3 4.7-4.6 4.9.4.3.7.9.7 1.9v2.7c0 .3.2.6.7.5A10 10 0 0 0 22 12c0-5.5-4.5-10-10-10Z" />
            </svg>
          </a>

          <MobileMenu onSearch={() => palette.setOpen(true)} />
        </div>
      </div>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </header>
  );
}
