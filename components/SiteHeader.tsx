'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TOOLS = [
  { href: '/scratchpad/', label: 'Scratchpad' },
  { href: '/in-list-builder/', label: 'IN list builder' },
  { href: '/bulk-query-generator/', label: 'Bulk generator' },
  { href: '/schema-diff/', label: 'Schema diff' },
  { href: '/sql-formatter/', label: 'Formatter' },
  { href: '/query-optimizer/', label: 'Optimizer' },
  { href: '/sql-converter/', label: 'Converter' },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border-card)] bg-[var(--surface-card)]/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">SQLParity</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {TOOLS.map((tool) => {
            const active = pathname === tool.href;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'rounded-md bg-accent-500/12 px-2.5 py-1.5 text-sm font-medium text-accent-700 dark:text-accent-400'
                    : 'rounded-md px-2.5 py-1.5 text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100'
                }
              >
                {tool.label}
              </Link>
            );
          })}
        </nav>

        <span className="ml-auto hidden items-center gap-1.5 text-xs text-ink-500 sm:flex dark:text-ink-400">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-3.5 fill-none stroke-current stroke-[1.5]"
          >
            <path d="M8 1.5 3 3.5v4c0 3 2.1 5.7 5 7 2.9-1.3 5-4 5-7v-4L8 1.5Z" />
          </svg>
          Runs entirely in your browser
        </span>
      </div>
    </header>
  );
}
