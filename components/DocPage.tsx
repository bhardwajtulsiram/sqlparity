import Link from 'next/link';
import { CheckIcon } from '@/components/icons';

export interface DocSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/**
 * The layout for the trust pages: Privacy, Terms and Security.
 *
 * Long documents that people skim for one answer, so each opens with the short
 * version in plain sentences, keeps a contents list in view on wide screens, and gives
 * every section an anchor that can be linked to from a ticket or an email.
 */
export function DocPage({
  kicker,
  title,
  intro,
  updated,
  summary,
  sections,
  related,
}: {
  kicker: string;
  title: string;
  intro: React.ReactNode;
  /** ISO date the text last changed. */
  updated: string;
  summary: string[];
  sections: DocSection[];
  related: { href: string; label: string }[];
}) {
  const date = new Date(`${updated}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div className="mx-auto max-w-6xl py-4">
      <header className="max-w-3xl">
        <p className="text-[13px] font-semibold text-accent-700 dark:text-accent-400">{kicker}</p>
        <h1 className="mt-2 text-[34px] leading-tight font-bold tracking-[-0.03em] sm:text-[44px]">{title}</h1>
        <div className="mt-4 text-[17px] leading-relaxed text-ink-600 dark:text-ink-300">{intro}</div>
        <p className="mt-4 text-[13px] text-ink-500 dark:text-ink-400">
          Last updated <time dateTime={updated}>{date}</time>
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14">
        <div className="min-w-0">
          <section
            aria-labelledby="short-version"
            className="rounded-2xl border border-[color-mix(in_oklab,var(--signal)_35%,transparent)] bg-[var(--signal-soft)] p-5 sm:p-6"
          >
            <h2 id="short-version" className="text-[15px] font-semibold">
              The short version
            </h2>
            <ul className="mt-3 space-y-2">
              {summary.map((line) => (
                <li key={line} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink-700 dark:text-ink-200">
                  <CheckIcon className="mt-1 size-4 shrink-0 text-[var(--signal)]" />
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-4">
            {sections.map((section, i) => (
              <section key={section.id} id={section.id} className="scroll-mt-24 border-b border-[var(--border-card)] py-8 last:border-b-0">
                <h2 className="flex items-baseline gap-3 text-[21px] font-semibold tracking-tight">
                  <span className="font-mono text-[13px] font-medium text-ink-400 dark:text-ink-500">{String(i + 1).padStart(2, '0')}</span>
                  {section.title}
                </h2>
                <div className="doc-prose mt-4">{section.body}</div>
              </section>
            ))}
          </div>
        </div>

        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24">
            <p className="text-[12.5px] font-semibold text-ink-500 dark:text-ink-400">On this page</p>
            <ol className="mt-3 space-y-1.5 border-l border-[var(--border-card)]">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="-ml-px block border-l border-transparent py-0.5 pl-3.5 text-[13px] text-ink-600 transition-colors hover:border-accent-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
            <p className="mt-8 text-[12.5px] font-semibold text-ink-500 dark:text-ink-400">Related</p>
            <ul className="mt-3 space-y-1.5">
              {related.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[13px] text-accent-700 hover:underline dark:text-accent-400">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}
