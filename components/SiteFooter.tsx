import Link from 'next/link';
import { ParityMark, ShieldIcon } from '@/components/icons';
import { TOOLS } from '@/components/tools';

/**
 * How the privacy claim is kept, in the order a sceptical reader would check it.
 * Each line is a mechanism, not an adjective.
 */
const GUARANTEES = [
  'Every tool computes its result in this tab.',
  'No account, and nothing you paste is uploaded or stored.',
  'The browser is told to refuse any request to another origin.',
  'Fonts and the query engine are served from this site.',
  'Visits are counted without cookies; what you paste is never part of it.',
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-16 border-t border-[var(--border-card)] bg-[var(--surface-card)]">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2.5">
            <ParityMark className="size-7" />
            <span className="text-[17px] font-semibold tracking-tight">SQLParity</span>
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            SQL tools for proving a migration copied every column correctly — without handing your
            table definitions to anyone.
          </p>
        </div>

        <div>
          <h2 className="text-[13px] font-semibold text-ink-900 dark:text-ink-100">Tools</h2>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-1">
            {TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link
                  href={tool.href}
                  className="group inline-flex items-center gap-2 text-sm text-ink-600 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
                >
                  <tool.Icon className="size-4 text-ink-400 group-hover:text-accent-600 dark:text-ink-500 dark:group-hover:text-accent-400" />
                  {tool.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-ink-900 dark:text-ink-100">
            <ShieldIcon className="size-4 text-[var(--signal)]" />
            How your data stays here
          </h2>
          <ul className="mt-4 space-y-2.5">
            {GUARANTEES.map((line) => (
              <li
                key={line}
                className="flex gap-2.5 text-sm leading-relaxed text-ink-600 dark:text-ink-400"
              >
                <span
                  aria-hidden="true"
                  className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-[var(--signal)]"
                />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-[var(--border-card)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-ink-500 sm:px-6 dark:text-ink-400">
          <p>© {new Date().getFullYear()} SQLParity</p>
          <p>Your settings are kept in this browser only.</p>
        </div>
      </div>
    </footer>
  );
}
