import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SqlFormatterTool } from '@/components/SqlFormatterTool';
import { DIALECTS, getDialect } from '@/lib/dialects';

export async function generateStaticParams() {
  return DIALECTS.map((d) => ({ dialect: d.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ dialect: string }>;
}): Promise<Metadata> {
  const { dialect: dialectId } = await params;
  const dialect = getDialect(dialectId);
  if (!dialect) return {};

  const title = `${dialect.label} SQL Formatter Online`;
  const description = `Format ${dialect.label} queries instantly in your browser. Configure keyword case (UPPER/lower), leading or trailing commas, indentation, and syntax checking with zero server uploads.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/sql-formatter/${dialect.id}/`,
    },
    openGraph: {
      title: `${title} — SQLParity`,
      description,
      url: `https://www.sqlparity.com/sql-formatter/${dialect.id}/`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — SQLParity`,
      description,
    },
  };
}

export default async function FormatterDialectPage({
  params,
}: {
  params: Promise<{ dialect: string }>;
}) {
  const { dialect: dialectId } = await params;
  const dialect = getDialect(dialectId);
  if (!dialect) notFound();

  const otherDialects = DIALECTS.filter((d) => d.id !== dialect.id).slice(0, 8);

  return (
    <div className="space-y-12">
      <SqlFormatterTool initialDialectId={dialect.id} />

      <section className="mt-12 rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 sm:p-8 shadow-[var(--shadow-card)] space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            {dialect.label} SQL Formatting & Syntax Rules
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            Format, beautify, and validate your {dialect.label} queries locally. Everything is parsed and formatted directly inside this browser tab with zero remote API calls.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Identifier Style</h3>
            <p className="mt-2 font-mono text-sm text-ink-800 dark:text-ink-200">
              <span className="text-accent-600 dark:text-accent-400">{dialect.identifier.open}column_name{dialect.identifier.close}</span>
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Escape internal delimiters via {dialect.identifier.escapeClose}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Comments Supported</h3>
            <p className="mt-2 font-mono text-xs text-ink-800 dark:text-ink-200">
              {dialect.lineComments.map((c) => `'${c}'`).join(', ')}
            </p>
            <p className="mt-1 text-xs text-ink-500">Line comments preserved during formatting</p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4 sm:col-span-2 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">String Escaping</h3>
            <p className="mt-2 text-xs text-ink-700 dark:text-ink-300">
              Quotes: {dialect.quoteEscape === 'double' ? "doubled ('')" : "backslash (\\')"}
              {dialect.backslashIsEscape ? ' · Backslash is escape character' : ' · Backslash is literal'}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-5">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white">Why Format {dialect.label} in the Browser?</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-400">
            Many enterprise teams forbid pasting confidential database queries into random online formatters because external servers can log query structure, database schemas, and data filters. SQLParity executes all formatting logic locally using WebAssembly and pure client-side JavaScript.
          </p>
        </div>

        <div className="border-t border-[var(--border-card)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500 mb-3">Other Dialect Formatters</h3>
          <div className="flex flex-wrap gap-2">
            {otherDialects.map((d) => (
              <Link
                key={d.id}
                href={`/sql-formatter/${d.id}/`}
                className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-sunken)] px-3 py-1.5 text-xs text-ink-700 hover:border-accent-500 hover:text-accent-600 dark:text-ink-300 dark:hover:text-accent-400 transition-colors"
              >
                {d.label} Formatter
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
