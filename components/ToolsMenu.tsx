'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRightIcon, ChevronDownIcon, NotEqualIcon } from '@/components/icons';
import { getTool, TOOL_GROUPS, toolsIn, type ToolInfo } from '@/components/tools';

/** Hover intent: open after a short dwell, close after a grace period. */
const OPEN_DELAY = 120;
const CLOSE_DELAY = 250;

/**
 * The Tools menu: every tool, grouped by the job it does, from one header item.
 *
 * Opens on hover for a mouse and on click or tap for everything else; the keyboard
 * can open it (Enter, Space, ↓), move through it (arrows, Home, End) and leave it
 * (Esc returns focus to the button). The panel is portalled to <body> — the header's
 * backdrop-filter would otherwise become the containing block for its fixed layers,
 * which is exactly what once trapped the command palette inside the header.
 */
export function ToolsMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(64);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set when the keyboard opened the menu, so focus moves into it once it renders. */
  const focusOnOpen = useRef(false);
  const id = useId();

  const onToolPage = TOOL_GROUPS.some((g) => toolsIn(g.id).some((t) => t.href === pathname));

  const schedule = (next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  const cancel = () => clearTimeout(timer.current);

  const close = useCallback((refocus = false) => {
    clearTimeout(timer.current);
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // Sit the panel exactly under the header, whatever its height on this page.
  useEffect(() => {
    if (!open) return;
    const header = button.current?.closest('header');
    if (header) setTop(header.getBoundingClientRect().bottom);
  }, [open]);

  // Navigating, scrolling the page or pressing Esc all close it.
  useEffect(() => close(), [pathname, close]);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Runs after the portal has committed, so the items exist to be focused.
  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false;
      panel.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus();
    }
  }, [open]);

  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];
  const focusItem = (index: number) => {
    const list = items();
    if (list.length === 0) return;
    list[(index + list.length) % list.length]!.focus();
  };

  const onPanelKey = (e: React.KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusItem(at + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusItem(at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(list.length - 1);
    }
  };

  const featured = getTool('/parity-run/');

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          cancel();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusOnOpen.current = true;
            setOpen(true);
          }
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') schedule(true, OPEN_DELAY);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') schedule(false, CLOSE_DELAY);
        }}
        className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium transition-colors ${
          open || onToolPage
            ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
            : 'text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/[0.06] dark:hover:text-white'
        }`}
      >
        Tools
        <ChevronDownIcon className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              className="animate-fade fixed inset-x-0 bottom-0 z-30 bg-ink-950/25 backdrop-blur-[2px]"
              style={{ top }}
              onPointerDown={() => close()}
            />
            <nav
              ref={panel}
              id={id}
              aria-label="All tools"
              onKeyDown={onPanelKey}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') cancel();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') schedule(false, CLOSE_DELAY);
              }}
              className="animate-palette fixed left-1/2 z-40 w-[min(62rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[0_2px_4px_oklch(0.2_0.02_265/0.06),0_30px_70px_-20px_oklch(0.2_0.05_265/0.4)]"
              style={{ top: top - 4 }}
            >
              <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,18.5rem)]">
                {TOOL_GROUPS.map((group) => (
                  <div key={group.id} className="p-4 pt-5">
                    <p className="mx-2 mb-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-ink-500 dark:text-ink-400">
                      <span aria-hidden="true" className="size-1.5 rounded-[2px]" style={{ background: group.color }} />
                      {group.name}
                    </p>
                    <ul className="space-y-0.5">
                      {toolsIn(group.id).map((tool) => (
                        <li key={tool.href}>
                          <MenuItem tool={tool} active={pathname === tool.href} onPick={() => close()} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                <div className="relative overflow-hidden p-5 text-[var(--syn-plain)]" style={{ background: 'var(--code-surface)' }}>
                  <div
                    aria-hidden="true"
                    className="absolute inset-0"
                    style={{
                      background:
                        'radial-gradient(260px 160px at 0% 0%, oklch(0.62 0.17 250 / 0.35), transparent 70%), radial-gradient(220px 140px at 100% 100%, oklch(0.78 0.13 162 / 0.18), transparent 70%)',
                    }}
                  />
                  <div className="relative">
                    <p className="text-[12px] font-semibold text-[var(--syn-string)]">Start here</p>
                    <p className="mt-1.5 text-[18px] leading-snug font-semibold tracking-tight text-white">
                      Prove two tables match
                    </p>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-[oklch(0.8_0.015_265)]">
                      Drop two copies of a table. Get every missing key and differing value — and a
                      sign-off report.
                    </p>
                    <div className="my-4 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px]" style={{ borderColor: 'var(--code-border)', background: 'var(--code-header)', color: 'var(--syn-identifier)' }}>
                        customers.csv
                      </span>
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_6px_16px_-4px_oklch(0.63_0.22_25/0.8)]">
                        <NotEqualIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px]" style={{ borderColor: 'var(--code-border)', background: 'var(--code-header)', color: 'var(--syn-identifier)' }}>
                        customers_copy.csv
                      </span>
                    </div>
                    <Link
                      href={`${featured.href}#example`}
                      data-menu-item
                      onClick={(e) => {
                        close();
                        // Already on the page: the router would change the URL without
                        // a hashchange event, so set the hash directly to trigger it.
                        if (pathname === featured.href) {
                          e.preventDefault();
                          window.location.hash = 'example';
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-white/15"
                    >
                      Try it with example data
                      <ArrowRightIcon className="size-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--border-card)] bg-[var(--surface-header)] px-6 py-3 text-[12.5px] text-ink-500 dark:text-ink-400">
                <span className="flex items-center gap-2">
                  <Kbd>Ctrl K</Kbd> jump to any tool from anywhere
                </span>
                <span className="flex items-center gap-2">
                  <Kbd>↑ ↓</Kbd> move <Kbd>Esc</Kbd> close
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--signal)]" />
                  Every tool runs in this tab
                </span>
              </div>
            </nav>
          </>,
          document.body,
        )}
    </>
  );
}

function MenuItem({ tool, active, onPick }: { tool: ToolInfo; active: boolean; onPick: () => void }) {
  return (
    <Link
      href={tool.href}
      data-menu-item
      aria-current={active ? 'page' : undefined}
      onClick={onPick}
      className={`group flex gap-3 rounded-xl p-2.5 outline-none transition-colors hover:bg-accent-500/[0.07] focus-visible:bg-accent-500/[0.09] ${
        active ? 'bg-accent-500/[0.09]' : ''
      }`}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-[9px] border"
        style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-string)' }}
      >
        <tool.Icon className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[14px] font-semibold text-ink-900 group-hover:text-accent-700 dark:text-ink-100 dark:group-hover:text-accent-300">
          {tool.name}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500 dark:text-ink-400">{tool.summary}</span>
      </span>
    </Link>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-[var(--border-card)] bg-[var(--surface-card)] px-1.5 font-mono text-[11px] leading-5 text-ink-500 dark:text-ink-400">
      {children}
    </kbd>
  );
}
