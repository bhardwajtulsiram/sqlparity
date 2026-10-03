import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SqlConverterTool } from '@/components/SqlConverterTool';
import { DIALECTS, getDialect } from '@/lib/dialects';

export async function generateStaticParams() {
  const paths: { pair: string }[] = [];
  for (const from of DIALECTS) {
    for (const to of DIALECTS) {
      if (from.id !== to.id) {
        paths.push({ pair: `${from.id}-to-${to.id}` });
      }
    }
  }
  return paths;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>;
}): Promise<Metadata> {
  const { pair } = await params;
  const parts = pair.split('-to-');
  if (parts.length !== 2) return {};

  const [fromId, toId] = parts;
  const from = getDialect(fromId);
  const to = getDialect(toId);
  if (!from || !to) return {};

  const title = `Convert ${from.label} to ${to.label} Online`;
  const description = `Convert queries from ${from.label} to ${to.label} locally in your browser. Handles identifier quoting (${from.identifier.open}...${from.identifier.close} to ${to.identifier.open}...${to.identifier.close}), limits, string escaping, and function names without uploading data.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/sql-converter/${pair}/`,
    },
    openGraph: {
      title: `${title} — SQLParity`,
      description,
      url: `https://www.sqlparity.com/sql-converter/${pair}/`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} — SQLParity`,
      description,
    },
  };
}

export default async function ConverterPairPage({
  params,
}: {
  params: Promise<{ pair: string }>;
}) {
  const { pair } = await params;
  const parts = pair.split('-to-');
  if (parts.length !== 2) notFound();

  const [fromId, toId] = parts;
  const from = getDialect(fromId);
  const to = getDialect(toId);
  if (!from || !to) notFound();

  const reversePair = `${to.id}-to-${from.id}`;

  return (
    <div className="space-y-12">
      <SqlConverterTool initialFromId={from.id} initialToId={to.id} />

      <section className="mt-12 rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 sm:p-8 shadow-[var(--shadow-card)] space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            Converting {from.label} to {to.label}: Key Syntax Differences
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            Translating SQL queries between {from.label} and {to.label} involves subtle dialect differences that standard text find-and-replace often misses. Everything below is processed entirely in your browser using SQLParity.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Identifier Quoting</h3>
            <p className="mt-2 font-mono text-sm text-ink-800 dark:text-ink-200">
              {from.label}: <span className="text-accent-600 dark:text-accent-400">{from.identifier.open}name{from.identifier.close}</span>
            </p>
            <p className="mt-1 font-mono text-sm text-ink-800 dark:text-ink-200">
              {to.label}: <span className="text-accent-600 dark:text-accent-400">{to.identifier.open}name{to.identifier.close}</span>
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">String Literal Escaping</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              <span className="font-semibold">{from.label}:</span> Quotes are {from.quoteEscape === 'double' ? "doubled ('')" : "escaped with backslash (\\')"}
              {from.backslashIsEscape ? ', backslash is an escape character.' : ', backslash is literal.'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              <span className="font-semibold">{to.label}:</span> Quotes are {to.quoteEscape === 'double' ? "doubled ('')" : "escaped with backslash (\\')"}
              {to.backslashIsEscape ? ', backslash is an escape character.' : ', backslash is literal.'}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4 sm:col-span-2 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Null-Safe Equality</h3>
            <p className="mt-2 font-mono text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              {to.label}: <code className="text-accent-600 dark:text-accent-400">{to.nullSafeNotEqual('colA', 'colB')}</code>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-5">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white">Why In-Browser SQL Conversion Matters</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-400">
            Database migrations frequently involve proprietary business logic, sensitive table schemas, and production column names. When converting SQL between {from.label} and {to.label}, SQLParity executes all parsing, tokenization, and code rewriting locally in your browser. Zero queries or schemas are transmitted to remote servers.
          </p>
        </div>

        <div className="border-t border-[var(--border-card)] pt-4 flex flex-wrap items-center justify-between gap-4">
          <Link
            href={`/sql-converter/${reversePair}/`}
            className="text-xs font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400 inline-flex items-center gap-1.5"
          >
            ← Need the opposite? Convert {to.label} to {from.label}
          </Link>
          <Link
            href="/sql-converter/"
            className="text-xs font-medium text-ink-500 hover:text-ink-700 dark:text-ink-400"
          >
            View all 16 SQL Dialects
          </Link>
        </div>
      </section>
    </div>
  );
}
