import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldIcon } from '@/components/icons';

export const metadata: Metadata = {
  title: 'Frequently Asked Questions — SQLParity',
  description:
    'Common questions about SQLParity: how the 100% in-browser privacy guarantee works, verifying zero network requests, DuckDB-WASM execution, and commercial usage.',
  alternates: {
    canonical: '/faq/',
  },
  openGraph: {
    title: 'Frequently Asked Questions — SQLParity',
    description:
      'Everything you need to know about SQLParity’s architecture, security guarantees, and SQL migration utilities.',
    url: 'https://www.sqlparity.com/faq/',
    type: 'website',
  },
};

const FAQ_SECTIONS = [
  {
    category: 'Privacy & Security Guarantees',
    items: [
      {
        question: 'How can I independently verify that SQLParity does not upload my queries or schemas?',
        answer:
          'Open your browser’s Developer Tools (F12 or right-click → Inspect), click the Network tab, and clear the log. Then paste queries into any tool, convert dialects, or run SQL on a CSV in the scratchpad. Notice that zero outgoing network requests occur. Everything computes directly in your computer’s RAM.',
      },
      {
        question: 'What is Content Security Policy and how does connect-src "self" protect my team?',
        answer:
          'A Content Security Policy (CSP) is an HTTP security header sent to your browser that restricts what resources the page is allowed to load. SQLParity sets connect-src "self", which strictly instructs the browser to block and throw a hard error on any attempt by any script to send data to an external API or remote origin.',
      },
      {
        question: 'I saw a network request when clicking "Download Excel". Is my data uploaded?',
        answer:
          'No. To keep initial page loads ultra-fast, SQLParity uses code-splitting (lazy loading). When you click the Excel download button for the first time, your browser downloads the ~20 KB JavaScript module (write-excel-file) required to assemble spreadsheets locally. You are downloading code into your browser, not uploading your data. You can verify this by checking the request payload—it contains zero data.',
      },
      {
        question: 'Are my settings, queries, or history saved on a server?',
        answer:
          'No. SQLParity has no backend database, no login system, and no user accounts. Basic UI preferences (like your preferred SQL dialect) are kept in your browser’s local storage only and never transmitted anywhere.',
      },
    ],
  },
  {
    category: 'Features & Technical Architecture',
    items: [
      {
        question: 'How does the DuckDB Scratchpad work inside the browser?',
        answer:
          'DuckDB is compiled into WebAssembly (WASM). When you drag and drop a Parquet, CSV, or TSV file, the browser File API reads the file directly into DuckDB’s in-memory WASM engine, allowing you to run full analytical SQL queries locally at native speeds.',
      },
      {
        question: 'What is the file size limit for Parquet or CSV files in the scratchpad?',
        answer:
          'Because DuckDB runs inside your browser’s WebAssembly memory space, performance depends on your computer’s available RAM. Files up to a few hundred megabytes (and hundreds of thousands of rows) typically query in seconds.',
      },
      {
        question: 'Which SQL dialects are supported across the tools?',
        answer:
          'SQLParity supports 16 major database engines: PostgreSQL, MySQL, SQLite, SQL Server (T-SQL), Oracle, MariaDB, Snowflake, Google BigQuery, Amazon Redshift, Trino / Athena, Apache Spark SQL, Apache Hive, ClickHouse, DuckDB, IBM Db2, and Standard SQL.',
      },
      {
        question: 'Does SQLParity work offline without an active internet connection?',
        answer:
          'Yes. After the initial page load has loaded the assets into your browser cache, the core parsing, formatting, diffing, and DuckDB querying operate completely offline.',
      },
    ],
  },
  {
    category: 'Licensing, Commercial Use & Open Source',
    items: [
      {
        question: 'Is SQLParity free to use for commercial and enterprise database migrations?',
        answer:
          'Yes. SQLParity is 100% free to use for personal, commercial, and enterprise workflows. There are no paid tiers or feature paywalls.',
      },
      {
        question: 'What open source license is SQLParity released under?',
        answer:
          'SQLParity is open source and licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). The full source code is publicly accessible on GitHub.',
      },
      {
        question: 'How can I report a syntax edge case or request support for another database engine?',
        answer:
          'You can open an issue or pull request directly on our GitHub repository at github.com/bhardwajtulsiram/sqlparity.',
      },
    ],
  },
];

export default function FaqPage() {
  const allFaqs = FAQ_SECTIONS.flatMap((s) => s.items);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: allFaqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  };

  return (
    <div className="mx-auto max-w-4xl space-y-16 py-4">
      {/* Schema.org FAQPage JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Header */}
      <section className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-card)] bg-[var(--surface-sunken)] px-3 py-1 text-xs text-ink-600 dark:text-ink-300">
          <ShieldIcon className="size-4 text-[var(--signal)]" />
          <span>Security & Usage Guide</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white leading-[1.15]">
          Frequently Asked Questions
        </h1>
        <p className="text-base sm:text-lg text-ink-600 dark:text-ink-300 leading-relaxed max-w-2xl">
          Everything you need to know about our browser-only architecture, privacy guarantees, and database tooling.
        </p>
      </section>

      {/* Sections */}
      <div className="space-y-12">
        {FAQ_SECTIONS.map((section, idx) => (
          <section key={idx} className="space-y-6">
            <h2 className="text-xl font-bold tracking-tight text-ink-900 dark:text-white">
              {section.category}
            </h2>

            <div className="divide-y divide-[var(--border-card)] rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-card)] overflow-hidden">
              {section.items.map((faq, itemIdx) => (
                <details
                  key={itemIdx}
                  className="group p-5 cursor-pointer transition-colors hover:bg-[var(--surface-sunken)] [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex items-center justify-between gap-4 font-medium text-sm text-ink-900 dark:text-white select-none">
                    <span>{faq.question}</span>
                    <span className="shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180">
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </summary>
                  <p className="mt-3 text-xs leading-relaxed text-ink-600 dark:text-ink-400 pr-6">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Need more help */}
      <section className="rounded-2xl border border-[var(--border-card)] bg-[var(--surface-sunken)] p-6 sm:p-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm text-ink-900 dark:text-white">
            Have a question or edge case not covered here?
          </h3>
          <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
            Open an issue or ask the community directly on GitHub.
          </p>
        </div>
        <a
          href="https://github.com/bhardwajtulsiram/sqlparity/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-ink-900 dark:bg-white px-4 py-2 text-xs font-semibold text-white dark:text-ink-900 hover:opacity-90 transition-opacity"
        >
          Ask on GitHub Issues →
        </a>
      </section>
    </div>
  );
}
