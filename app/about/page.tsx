import type { Metadata } from 'next';
import Link from 'next/link';
import { ParityMark, ShieldIcon, SparkIcon } from '@/components/icons';

export const metadata: Metadata = {
  title: 'About SQLParity — Why We Built Privacy-First SQL Tools',
  description:
    'The story behind SQLParity: built for data engineers, DBAs, and analysts who need fast migration and validation tools without violating enterprise Infosec policies.',
  alternates: {
    canonical: '/about/',
  },
  openGraph: {
    title: 'About SQLParity — Why We Built Privacy-First SQL Tools',
    description:
      'SQL tools designed around one job: proving data migrations copied every column correctly without handing your schemas to anyone.',
    url: 'https://www.sqlparity.com/about/',
    type: 'website',
  },
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-16 py-4">
      {/* Hero */}
      <section className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-card)] bg-[var(--surface-sunken)] px-3 py-1 text-xs text-ink-600 dark:text-ink-300">
          <ParityMark className="size-4" />
          <span>The Philosophy Behind SQLParity</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white leading-[1.15]">
          Built for the migrations you cannot paste into the cloud.
        </h1>
        <p className="text-base sm:text-lg text-ink-600 dark:text-ink-300 leading-relaxed max-w-3xl">
          SQLParity exists because database migrations are high-stakes, stressful, and heavily scrutinized by enterprise security teams.
        </p>
      </section>

      {/* The Real Problem */}
      <section className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 sm:p-10 shadow-[var(--shadow-card)] space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-red-500/10 text-red-500 ring-1 ring-red-500/30">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            The Problem: The Online Tool Security Dilemma
          </h2>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          <p>
            Whenever a team migrates from an on-prem SQL Server to PostgreSQL, moves MySQL pipelines into Snowflake, or audits whether an ETL job dropped rows, engineers need quick utility tools: a schema diff, a dialect translator, an IN-clause builder, or a quick way to inspect a Parquet extract.
          </p>
          <p>
            However, almost every online SQL utility on the web sends your pasted code to a remote backend server. Under SOC2, HIPAA, banking regulations, and GDPR compliance, pasting proprietary schemas, customer column names, or financial queries into random web tools is strictly forbidden.
          </p>
          <p>
            Developers were left with two bad choices: build clumsy one-off Python scripts, or manually eyeball hundreds of columns and hope nothing broke silently.
          </p>
        </div>
      </section>

      {/* The Solution */}
      <section className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            Our Core Principles
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">
            How SQLParity re-engineers developer utilities from the ground up.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-card)] space-y-3">
            <div className="flex items-center gap-2 text-accent-600 dark:text-accent-400">
              <ShieldIcon className="size-5" />
              <h3 className="font-semibold text-ink-900 dark:text-white">1. Enforced by Code, Not Promises</h3>
            </div>
            <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-400">
              Saying &ldquo;we don&apos;t store your data&rdquo; is a promise. Serving a Content Security Policy header with <code className="text-accent-600 dark:text-accent-400">connect-src &apos;self&apos;</code> is an architectural guarantee: your browser is technically forbidden from sending data to any external server.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-card)] space-y-3">
            <div className="flex items-center gap-2 text-accent-600 dark:text-accent-400">
              <SparkIcon className="size-5" />
              <h3 className="font-semibold text-ink-900 dark:text-white">2. Real In-Browser Compute</h3>
            </div>
            <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-400">
              Instead of sending queries to a cloud server, SQLParity runs WebAssembly inside your browser. DuckDB-WASM executes analytical SQL queries against local Parquet and CSV files directly using your device&apos;s CPU and RAM.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-card)] space-y-3">
            <div className="flex items-center gap-2 text-accent-600 dark:text-accent-400">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="font-semibold text-ink-900 dark:text-white">3. Show the Receipts</h3>
            </div>
            <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-400">
              When translating a query across dialects, bad tools guess and silently return broken SQL. SQLParity provides receipts: an itemized list of every change made, plus an explicit list of non-portable functions left alone for human review.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-card)] space-y-3">
            <div className="flex items-center gap-2 text-accent-600 dark:text-accent-400">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <h3 className="font-semibold text-ink-900 dark:text-white">4. No Cookies, No Tracking</h3>
            </div>
            <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-400">
              No cookies, nothing you paste is ever tracked. No login walls, no email gates, and no paywalls. You bookmark the URL and use it when you need it.
            </p>
          </div>
        </div>
      </section>

      {/* Open Source Callout */}
      <section className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-6 sm:p-8 space-y-4">
        <h2 className="text-lg font-bold text-ink-900 dark:text-white">
          Open Source & Community Driven
        </h2>
        <p className="text-xs sm:text-sm leading-relaxed text-ink-600 dark:text-ink-400">
          SQLParity is open source under the AGPL-3.0 license. You can inspect the source code, verify the client-side parsing algorithms, run it locally, or contribute dialect enhancements directly on GitHub.
        </p>
        <div className="flex flex-wrap gap-4 pt-2">
          <a
            href="https://github.com/bhardwajtulsiram/sqlparity"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-ink-900 dark:bg-white px-4 py-2 text-xs font-semibold text-white dark:text-ink-900 hover:opacity-90 transition-opacity"
          >
            <svg className="size-4 fill-current" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            View on GitHub
          </a>
          <Link
            href="/faq/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-4 py-2 text-xs font-semibold text-ink-700 dark:text-ink-200 hover:border-accent-500 transition-colors"
          >
            Read Technical FAQs →
          </Link>
          <a
            href="mailto:contact@sqlparity.com"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-4 py-2 text-xs font-semibold text-ink-700 dark:text-ink-200 hover:border-accent-500 transition-colors"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span>Contact: contact@sqlparity.com</span>
          </a>
        </div>
      </section>
    </div>
  );
}
