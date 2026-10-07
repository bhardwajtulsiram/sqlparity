import type { Metadata } from 'next';
import { InListBuilder } from '@/components/InListBuilder';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'SQL IN List Builder — Quoted, Escaped IN Clauses for Any Dialect',
  description:
    'Paste a column of values and get a properly quoted, escaped IN (...) clause for PostgreSQL, MySQL, SQL Server, BigQuery, Athena and more. Runs entirely in your browser.',
  alternates: {
    canonical: '/in-list-builder/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Paste Raw Values',
    description:
      'Copy a column of IDs, emails, or codes from Excel, CSV, or a spreadsheet and paste them into the box.',
  },
  {
    step: 2,
    title: 'Select Target Dialect',
    description:
      'Choose your database engine to automatically apply the correct quoting and escape rules for apostrophes and slashes.',
  },
  {
    step: 3,
    title: 'Copy Formatted IN Clause',
    description:
      'Copy the ready-to-run IN (...) clause with proper comma separation, indentation, and chunking.',
  },
];

const FAQS = [
  {
    question: "How does SQLParity handle names with apostrophes (e.g., O'Brien)?",
    answer:
      "In standard SQL dialects (like Postgres, SQL Server, and Snowflake), single quotes are doubled ('O''Brien'). In MySQL and BigQuery, dialect-specific backslash escaping is applied automatically.",
  },
  {
    question: 'Are leading zeros preserved (like SKU 00412)?',
    answer:
      'Yes. Unlike Excel which often strips leading zeros, SQLParity preserves exact string formatting so numeric codes with leading zeros are quoted correctly as text literals.',
  },
  {
    question: "What happens if I exceed Oracle's 1000 item IN-list limit?",
    answer:
      'SQLParity warns you if your list exceeds database hard limits (such as Oracle ORA-01795) and helps you split or chunk the clause safely.',
  },
  {
    question: 'Can it strip duplicates or trim whitespace automatically?',
    answer:
      'Yes. Leading and trailing whitespace is trimmed, empty rows are omitted, and you can format the output across multiple lines or as a compact single line.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <InListBuilder />
      <ToolFaqSection
        toolName="SQL IN List Builder"
        tagline="How to convert raw spreadsheet lists into safe, correctly escaped SQL clauses."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
