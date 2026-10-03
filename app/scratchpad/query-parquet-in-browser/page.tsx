import type { Metadata } from 'next';
import Link from 'next/link';
import { SqlScratchpadTool } from '@/components/SqlScratchpadTool';

export const metadata: Metadata = {
  title: 'Query Parquet in Browser — DuckDB WASM Parquet Viewer',
  description:
    'Inspect, query, and analyze Parquet files directly in your browser using real SQL and DuckDB WebAssembly. Your files are read from local disk and never uploaded to any server.',
  alternates: {
    canonical: '/scratchpad/query-parquet-in-browser/',
  },
  openGraph: {
    title: 'Query Parquet in Browser — DuckDB WASM Parquet Viewer — SQLParity',
    description:
      'Run SQL queries on Parquet files locally in your browser tab. Powered by DuckDB WebAssembly — zero data uploads.',
    url: 'https://www.sqlparity.com/scratchpad/query-parquet-in-browser/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Query Parquet in Browser — DuckDB WASM Parquet Viewer',
    description: 'Inspect and query local Parquet files with DuckDB in your browser tab. Zero uploads.',
  },
};

export default function QueryParquetPage() {
  return (
    <div className="space-y-12">
      <SqlScratchpadTool />

      <section className="mt-12 rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 sm:p-8 shadow-[var(--shadow-card)] space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            Query Parquet Files in Your Browser with DuckDB WASM
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            Apache Parquet is the industry standard for columnar data storage, but inspecting a file usually requires firing up Python, installing Pandas or DuckDB, or spinning up a Jupyter notebook. SQLParity brings the full power of DuckDB WebAssembly directly to your browser tab.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">100% Client-Side</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              The browser File System API reads the Parquet file bytes directly into DuckDB's in-memory WebAssembly instance. No network requests are made.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Full Columnar Speed</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              DuckDB reads column metadata, statistics, and individual row groups on-demand, enabling fast aggregations, filters, and joins even on multi-hundred megabyte files.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4 sm:col-span-2 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Export Anytime</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              Run your query, inspect the results in the table, and export query subsets back to CSV or TSV with one click.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-5">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white">Security & Compliance Guarantee</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-400">
            Internal customer records, transaction logs, and analytical extracts should never be uploaded to random online file viewers. SQLParity enforces a strict browser Content Security Policy (<code className="text-accent-600 dark:text-accent-400">connect-src &apos;self&apos;</code>) to guarantee that your Parquet data never leaves your machine.
          </p>
        </div>

        <div className="border-t border-[var(--border-card)] pt-4 flex items-center justify-between text-xs">
          <Link
            href="/scratchpad/query-csv-online/"
            className="text-accent-600 hover:text-accent-700 dark:text-accent-400 font-medium"
          >
            Looking to query CSV files instead? →
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
