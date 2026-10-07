import Link from 'next/link';
import { ParityMark, ShieldIcon } from '@/components/icons';
import { TOOL_GROUPS, toolsIn } from '@/components/tools';

const GITHUB = 'https://github.com/bhardwajtulsiram/sqlparity';
const EMAIL = 'contact@sqlparity.com';

/** The site's own pages, and the places a team evaluating it will look for. */
const PROJECT = [
  { href: '/about/', label: 'About' },
  { href: '/faq/', label: 'FAQ' },
  { href: GITHUB, label: 'GitHub', external: true },
  { href: `${GITHUB}/issues`, label: 'Report an issue', external: true },
];

const TRUST = [
  { href: '/privacy/', label: 'Privacy policy' },
  { href: '/terms/', label: 'Terms of use' },
  { href: 'https://github.com/bhardwajtulsiram/sqlparity/blob/main/SECURITY.md', label: 'Report a vulnerability', external: true },
  { href: `${GITHUB}/blob/main/TRADEMARK.md`, label: 'Trademark policy', external: true },
];

function FooterLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const className = 'text-[13.5px] text-ink-600 transition-colors hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100';
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
      <span aria-hidden="true" className="ml-1 text-ink-400">
        ↗
      </span>
    </a>
  ) : (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

function Column({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[13px] font-semibold text-ink-900 dark:text-ink-100">{title}</h2>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </div>
  );
}

/**
 * Tools by the same three groups as the header menu and the home page, then the
 * project, then the trust pages an infosec reviewer looks for first.
 */
export function SiteFooter() {
  const [verify, write, explore] = TOOL_GROUPS;

  return (
    <footer className="relative z-10 mt-24 border-t border-[var(--border-card)] bg-[var(--surface-card)]">
      <div className="border-b border-[var(--border-card)] bg-[var(--surface-header)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-[15px] font-semibold">Questions, feedback or a dialect request?</h2>
            <p className="mt-0.5 text-[13.5px] text-ink-600 dark:text-ink-400">
              Write to us directly — including commercial and security enquiries.
            </p>
          </div>
          <a
            href={`mailto:${EMAIL}`}
            className="inline-flex h-10 items-center gap-2 self-start rounded-lg bg-ink-900 px-4 text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90 sm:self-auto dark:bg-white dark:text-ink-900"
          >
            {EMAIL}
          </a>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <ParityMark className="size-7" />
            <span className="text-[17px] font-semibold tracking-tight">SQLParity</span>
          </Link>
          <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-ink-600 dark:text-ink-400">
            SQL tools for proving a migration copied every column correctly — without handing your data to anyone.
          </p>
          <p className="mt-4 flex items-center gap-2 text-[12.5px] text-ink-500 dark:text-ink-400">
            <ShieldIcon className="size-4 text-[var(--signal)]" />
            Every tool runs in your browser tab.
          </p>
        </div>

        {[verify!, write!].map((group) => (
          <Column key={group.id} title={group.name}>
            {toolsIn(group.id).map((tool) => (
              <li key={tool.href}>
                <FooterLink href={tool.href} label={tool.name} />
              </li>
            ))}
          </Column>
        ))}

        <div className="space-y-8">
          <Column title={explore!.name}>
            {toolsIn(explore!.id).map((tool) => (
              <li key={tool.href}>
                <FooterLink href={tool.href} label={tool.name} />
              </li>
            ))}
          </Column>
          <Column title="Project">
            {PROJECT.map((link) => (
              <li key={link.href}>
                <FooterLink {...link} />
              </li>
            ))}
          </Column>
        </div>

        <Column title="Trust">
          {TRUST.map((link) => (
            <li key={link.href}>
              <FooterLink {...link} />
            </li>
          ))}
        </Column>
      </div>

      <div className="border-t border-[var(--border-card)]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 text-[12.5px] text-ink-500 sm:px-6 dark:text-ink-400">
          <p>© {new Date().getFullYear()} SQLParity · Code licensed under AGPLv3</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <Link href="/privacy/" className="hover:text-ink-800 dark:hover:text-ink-200">
              Privacy
            </Link>
            <Link href="/terms/" className="hover:text-ink-800 dark:hover:text-ink-200">
              Terms
            </Link>
          </nav>
          <p className="w-full sm:w-auto">Your settings are kept in this browser only.</p>
        </div>
      </div>
    </footer>
  );
}
