import type { Metadata } from 'next';
import Link from 'next/link';
import { SqlScratchpadTool } from '@/components/SqlScratchpadTool';

export const metadata: Metadata = {
  title: 'Query CSV Online with SQL — DuckDB WASM In-Browser',
  description:
    'Query CSV, TSV, or JSON files with full SQL syntax directly in your browser. DuckDB WebAssembly runs in the tab so your data is never uploaded to any remote server.',
  alternates: {
    canonical: '/scratchpad/query-csv-online/',
  },
  openGraph: {
    title: 'Query CSV Online with SQL — DuckDB WASM — SQLParity',
    description:
      'Run SQL queries on CSV and TSV files locally in your browser. Powered by DuckDB WebAssembly — zero server uploads.',
    url: 'https://www.sqlparity.com/scratchpad/query-csv-online/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Query CSV Online with SQL — DuckDB WASM',
    description: 'Drop any CSV or TSV file and run real SQL in your browser tab with DuckDB. Zero uploads.',
  },
};

export default function QueryCsvPage() {
  return (
    <div className="space-y-12">
      <SqlScratchpadTool />

      <section className="mt-12 rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 sm:p-8 shadow-[var(--shadow-card)] space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            Query Large CSV and TSV Files with SQL in Your Browser
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            Excel freezes on files larger than 100,000 rows, and importing a CSV into a local SQLite or PostgreSQL database requires database setup, table creation, and import scripts. SQLParity allows you to drag and drop a CSV file and immediately query it with standard SQL.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Automatic Schema Sniffing</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              DuckDB automatically detects column types (dates, integers, decimals, text) and delimiters without requiring you to manually write a DDL schema first.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Full SQL Power</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              Use window functions, CTEs (WITH clauses), GROUP BY aggregates, complex JOINs, and regex filters just like in a production analytical data warehouse.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4 sm:col-span-2 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Zero Uploads</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              Your CSV data stays entirely in your browser&apos;s memory. The browser refuses external network requests, preserving complete privacy.
            </p>
          </div>
        </div>

        <div className="border-t border-[var(--border-card)] pt-4 flex items-center justify-between text-xs">
          <Link
            href="/scratchpad/query-parquet-in-browser/"
            className="text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium"
          >
            Want to query Apache Parquet files instead? →
          </Link>
          <Link
            href="/scratchpad/"
            className="text-ink-500 hover:text-ink-700 dark:text-ink-400"
          >
            Back to Scratchpad Overview
          </Link>
        </div>
      </section>
    </div>
  );
}
