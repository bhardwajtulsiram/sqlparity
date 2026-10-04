import type { Metadata } from 'next';
import Link from 'next/link';
import { InListBuilder } from '@/components/InListBuilder';

export const metadata: Metadata = {
  title: 'Fix Oracle ORA-01795: Split SQL IN List into 1000-Item Chunks',
  description:
    'Bypass Oracle error ORA-01795 (maximum number of expressions in a list is 1000). Paste thousands of IDs or codes and automatically chunk them into WHERE col IN (...) OR col IN (...) clauses. 100% in-browser, no upload.',
  alternates: {
    canonical: '/in-list-builder/oracle-1000-limit/',
  },
  openGraph: {
    title: 'Fix Oracle ORA-01795: Split SQL IN List into 1000 Chunks — SQLParity',
    description:
      'Auto-chunk large SQL IN lists for Oracle Database without hitting ORA-01795. 100% computed in your browser.',
    url: 'https://www.sqlparity.com/in-list-builder/oracle-1000-limit/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Fix Oracle ORA-01795: Split SQL IN List into 1000 Chunks',
    description:
      'Paste raw IDs and get batched Oracle IN clauses that bypass the 1000 expression limit. Zero data uploads.',
  },
};

const ORACLE_FAQ = [
  {
    question: 'What causes Oracle error ORA-01795: maximum number of expressions in a list is 1000?',
    answer:
      'Oracle Database has a hardcoded parser limit of 1,000 literal elements in a single comma-separated IN list (e.g. WHERE id IN (1, 2, ..., 1001)). If your query passes 1,001 or more expressions, Oracle immediately rejects the query with ORA-01795.',
  },
  {
    question: 'How does SQLParity split large lists to avoid ORA-01795?',
    answer:
      'SQLParity groups your values into batches of 1,000 and connects them with OR operators: WHERE (id IN (1..1000) OR id IN (1001..2000)). Oracle evaluates each chunk as an independent list, executing the query normally.',
  },
  {
    question: 'What other workarounds exist for the Oracle 1000 IN list limit?',
    answer:
      'Common alternatives include: 1) The composite tuple workaround WHERE (id, 0) IN ((val1, 0), (val2, 0)...), which Oracle permits beyond 1,000 items; 2) Inserting items into a Global Temporary Table (GTT) and using an INNER JOIN or subquery; 3) Using XMLTABLE or JSON_TABLE arrays.',
  },
  {
    question: 'Does splitting into multiple OR clauses affect Oracle query performance?',
    answer:
      'For indexed columns, the Oracle Cost-Based Optimizer (CBO) handles chained OR IN clauses by executing an index range scan (CONCATENATION or INLIST ITERATOR) efficiently. However, for extremely large lists (>20,000 items), loading into a temporary table is recommended.',
  },
];

export default function Oracle1000LimitPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ORACLE_FAQ.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  };

  return (
    <div className="space-y-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <InListBuilder
        initialDialectId="plsql"
        initialChunking={true}
        initialChunkSize={1000}
        initialShape="where"
        initialColumnName="customer_id"
      />

      {/* Educational Guide */}
      <section className="mt-12 rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-6 sm:p-8 shadow-[var(--shadow-card)] space-y-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900 dark:text-white">
            How to Bypass Oracle ORA-01795: Maximum Number of Expressions in a List is 1000
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
            Anyone migrating data, auditing financial records, or running ad-hoc queries on Oracle Database has encountered this classic error:
          </p>
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2.5 font-mono text-xs text-red-600 dark:text-red-400">
            ORA-01795: maximum number of expressions in a list is 1000
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">The Hard Limit</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              Oracle SQL imposes a hard parser restriction allowing a maximum of 1,000 values inside an <code className="font-mono">IN (...)</code> clause. A 1,001st value halts query execution immediately.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">The Chunker Fix</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              The standard fix wraps values in parentheses connected by <code className="font-mono">OR</code>: <code className="font-mono">WHERE (id IN (1..1000) OR id IN (1001..2000))</code>. SQLParity automates this instantly.
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4 sm:col-span-2 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-500">100% In-Browser</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
              Paste customer IDs, social security numbers, or transaction hashes directly from Excel. Zero data leaves your browser RAM.
            </p>
          </div>
        </div>

        {/* Workarounds breakdown */}
        <div className="space-y-4 pt-4 border-t border-[var(--border-card)]">
          <h3 className="text-base font-semibold text-ink-900 dark:text-white">
            Comparing the 3 Ways to Handle &gt;1,000 Values in Oracle
          </h3>

          <div className="space-y-3 text-xs leading-relaxed text-ink-700 dark:text-ink-300">
            <div className="rounded-xl border border-[var(--border-card)] p-4 bg-[var(--surface-sunken)]/50">
              <span className="font-bold text-ink-900 dark:text-white">1. Chained OR IN Clauses (Generated Above):</span>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--code-surface)] p-2.5 font-mono text-[11px] text-[var(--syn-plain)]">
{`WHERE (customer_id IN ('C001', 'C002', /* ...up to 1,000 items... */)
    OR customer_id IN ('C1001', 'C1002', /* ...up to 2,000 items... */))`}
              </pre>
              <p className="mt-2 text-ink-500">
                <strong>Best for:</strong> Ad-hoc queries, scripts, and quick data triage. Requires no DDL privileges or temporary table creation.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-card)] p-4 bg-[var(--surface-sunken)]/50">
              <span className="font-bold text-ink-900 dark:text-white">2. Composite Tuple Workaround:</span>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--code-surface)] p-2.5 font-mono text-[11px] text-[var(--syn-plain)]">
{`WHERE (customer_id, 0) IN (('C001', 0), ('C002', 0), ...)`}
              </pre>
              <p className="mt-2 text-ink-500">
                <strong>Best for:</strong> Older scripts where parentheses cannot be rewritten easily. Oracle treats multi-column tuples as a single composite expression and bypasses the 1,000 literal limit.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-card)] p-4 bg-[var(--surface-sunken)]/50">
              <span className="font-bold text-ink-900 dark:text-white">3. Global Temporary Table (GTT):</span>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--code-surface)] p-2.5 font-mono text-[11px] text-[var(--syn-plain)]">
{`CREATE GLOBAL TEMPORARY TABLE temp_ids (id VARCHAR2(50)) ON COMMIT PRESERVE ROWS;
-- insert IDs and join
SELECT * FROM sales s JOIN temp_ids t ON s.customer_id = t.id;`}
              </pre>
              <p className="mt-2 text-ink-500">
                <strong>Best for:</strong> Production ETL jobs handling 50,000+ items where parsing huge SQL strings adds overhead to Oracle's shared pool.
              </p>
            </div>
          </div>
        </div>

        {/* FAQs */}
        <div className="space-y-4 pt-4 border-t border-[var(--border-card)]">
          <h3 className="text-base font-semibold text-ink-900 dark:text-white">
            Frequently Asked Questions
          </h3>
          <div className="space-y-3">
            {ORACLE_FAQ.map((faq, i) => (
              <div key={i} className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-4">
                <h4 className="text-xs font-semibold text-ink-900 dark:text-white">{faq.question}</h4>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-600 dark:text-ink-400">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--border-card)] flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/in-list-builder/"
            className="text-xs font-medium text-accent-600 dark:text-accent-400 hover:underline"
          >
            ← Back to standard SQL IN List Builder
          </Link>
          <Link
            href="/sql-converter/"
            className="text-xs font-medium text-accent-600 dark:text-accent-400 hover:underline"
          >
            Convert Oracle queries to Postgres, MySQL & Snowflake →
          </Link>
        </div>
      </section>
    </div>
  );
}
