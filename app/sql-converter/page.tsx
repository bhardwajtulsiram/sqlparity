import type { Metadata } from 'next';
import { SqlConverterTool } from '@/components/SqlConverterTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'SQL Dialect Converter — Translate Queries Between 16 Databases',
  description:
    'Convert SQL between PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, BigQuery, Athena and more — quoting, string escaping, row limits and function names, with an explicit list of what needs a human. Runs entirely in your browser.',
  alternates: {
    canonical: '/sql-converter/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Choose From & To Dialects',
    description:
      'Select your source database engine in the "From" dropdown and your destination database in the "To" dropdown.',
  },
  {
    step: 2,
    title: 'Paste Your Query',
    description:
      'Paste your original SQL query into the left panel. The tool begins converting immediately as you type.',
  },
  {
    step: 3,
    title: 'Inspect Receipts & Copy',
    description:
      'Review the rewritten query, check the list of changes made, and review any items flagged for human verification.',
  },
];

const FAQS = [
  {
    question: 'What syntax differences does SQLParity translate automatically?',
    answer:
      'It translates identifier delimiters (brackets to quotes or backticks), row limit syntax (TOP n vs. LIMIT n), string escaping rules, date functions, null checks (ISNULL to COALESCE), and string length functions (LEN to LENGTH with RTRIM).',
  },
  {
    question: 'What does "What you still need to do" mean in the SQL Converter?',
    answer:
      'Instead of blindly guessing at complex stored procedures or proprietary engine functions and returning SQL that fails silently, SQLParity lists any non-portable constructs that require manual human review.',
  },
  {
    question: 'Can I check that the converted query actually runs?',
    answer:
      'Yes, when the target is PostgreSQL, SQLite or DuckDB. The converted query runs on that real database engine inside your browser tab, against sample tables guessed from the query that you can edit. When the source is one of the three as well, the original runs alongside it on the same data and the two results are compared row by row.',
  },
  {
    question: 'Are queries sent to an AI backend or third-party translation server?',
    answer:
      'No. The entire conversion logic runs locally inside your browser tab using deterministically tested parsers and tokenizers. No queries are uploaded or logged.',
  },
  {
    question: 'How many database pairs can I convert between?',
    answer:
      'All 16 supported dialects can be converted to any other dialect, providing 240 pairwise translation paths including SQL Server to Postgres, MySQL to Snowflake, and Oracle to BigQuery.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <SqlConverterTool />
      <ToolFaqSection
        toolName="SQL Dialect Converter"
        tagline="How to translate SQL queries between 16 database engines without data leaks."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
