'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EraseIcon, MenuIcon, SearchIcon } from '@/components/icons';
import { TOOL_GROUPS, toolsIn } from '@/components/tools';
import { PrivacyReading, SITE_LINKS } from '@/components/SiteNav';

/**
 * The header's navigation below the desktop breakpoint: one button that opens a
 * full-screen sheet with the same three tool groups as the desktop menu, the site
 * links, search and the privacy reading. Portalled to <body> for the same reason as
 * the desktop menu — the header's backdrop-filter would clip a fixed layer to itself.
 */
export function MobileMenu({ onSearch }: { onSearch: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(64);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const header = button.current?.closest('header');
    if (header) setTop(header.getBoundingClientRect().bottom);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
        className="flex size-10 items-center justify-center rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] text-ink-700 shadow-[var(--shadow-control)] lg:hidden dark:text-ink-200"
      >
        {open ? <EraseIcon className="size-5" /> : <MenuIcon className="size-5" />}
      </button>

      {open &&
        createPortal(
          <div
            id="mobile-menu"
            className="animate-fade fixed inset-x-0 bottom-0 z-40 overflow-y-auto bg-[var(--surface-card)] px-4 pt-4 pb-8 lg:hidden"
            style={{ top }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSearch();
              }}
              className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-[var(--border-card)] px-3.5 text-[14px] text-ink-500 dark:text-ink-400"
            >
              <SearchIcon className="size-4" />
              Search tools
            </button>

            {TOOL_GROUPS.map((group) => (
              <section key={group.id} className="mt-5">
                <h2 className="mx-1 mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-ink-500 dark:text-ink-400">
                  <span aria-hidden="true" className="size-1.5 rounded-[2px]" style={{ background: group.color }} />
                  {group.name}
                </h2>
                <ul>
                  {toolsIn(group.id).map((tool) => (
                    <li key={tool.href}>
                      <Link
                        href={tool.href}
                        aria-current={pathname === tool.href ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-xl p-2 ${pathname === tool.href ? 'bg-accent-500/[0.09]' : ''}`}
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-[9px] border"
                          style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-string)' }}
                        >
                          <tool.Icon className="size-[18px]" />
                        </span>
                        <span className="flex items-center gap-2 text-[15px] font-semibold">
                          {tool.name}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <ul className="mt-6 grid grid-cols-2 gap-2 border-t border-[var(--border-card)] pt-5">
              {SITE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="block rounded-lg px-2 py-2 text-[14.5px] font-medium text-ink-700 dark:text-ink-200">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex justify-center">
              <PrivacyReading always />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
