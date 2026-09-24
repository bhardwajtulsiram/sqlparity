'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightIcon, OverviewIcon, SearchIcon } from '@/components/icons';
import { TOOLS } from '@/components/tools';

const ENTRIES = [
  {
    href: '/',
    name: 'Overview',
    summary: 'Every tool on one page.',
    keywords: 'home start overview',
    Icon: OverviewIcon,
  },
  ...TOOLS,
];

/**
 * Jump to any tool from the keyboard.
 *
 * Seven tools is past the point where scanning a row of tabs is quicker than typing
 * two letters, and people who live in SQL editors expect Ctrl+K. It opens on
 * Ctrl+K / Cmd+K from anywhere, and on "/" when focus is not in a field.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const typing =
          target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null;
        if (!typing) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENTRIES;
    return ENTRIES.filter((e) =>
      `${e.name} ${e.summary} ${e.keywords}`.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setIndex(0);
    // Effects run after commit, so the input already exists. Not deferred to a frame:
    // a background tab throttles rAF, and keys typed straight after Ctrl+K would be lost.
    input.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      returnFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-ink-950/45 px-4 pt-[12vh] backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Go to a tool"
        className="animate-palette w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-raised)]"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = results[index];
            if (hit) go(hit.href);
          } else if (e.key === 'Tab') {
            // One focusable field; keep focus inside the dialog.
            e.preventDefault();
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-card)] px-4">
          <SearchIcon className="size-[18px] shrink-0 text-ink-400" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to a tool…"
            aria-label="Search tools"
            aria-controls="palette-results"
            aria-activedescendant={results[index] ? `palette-${index}` : undefined}
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-400"
          />
          <kbd className="hidden shrink-0 rounded-md border border-[var(--border-card)] bg-[var(--surface-header)] px-1.5 py-0.5 font-mono text-[11px] text-ink-500 sm:block dark:text-ink-400">
            Esc
          </kbd>
        </div>

        <ul id="palette-results" role="listbox" className="max-h-[min(60vh,26rem)] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-ink-500 dark:text-ink-400">
              No tool matches &ldquo;{query}&rdquo;.
            </li>
          )}
          {results.map((entry, i) => {
            const active = i === index;
            return (
              <li
                key={entry.href}
                id={`palette-${i}`}
                role="option"
                aria-selected={active}
                onMouseMove={() => setIndex(i)}
                onClick={() => go(entry.href)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${
                  active ? 'bg-accent-500/10' : ''
                }`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${
                    active
                      ? 'border-transparent bg-[var(--code-surface)] text-[var(--syn-string)]'
                      : 'border-[var(--border-card)] bg-[var(--surface-header)] text-ink-600 dark:text-ink-300'
                  }`}
                >
                  <entry.Icon className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-medium ${
                      active ? 'text-accent-700 dark:text-accent-400' : ''
                    }`}
                  >
                    {entry.name}
                  </span>
                  <span className="block truncate text-[13px] text-ink-500 dark:text-ink-400">
                    {entry.summary}
                  </span>
                </span>
                <ArrowRightIcon
                  className={`ml-auto size-4 shrink-0 text-accent-600 transition-opacity dark:text-accent-400 ${
                    active ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-[var(--border-card)] bg-[var(--surface-header)] px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--border-card)] bg-[var(--surface-card)] px-1 font-mono text-[11px] leading-4">
      {children}
    </kbd>
  );
}
