import type { Metadata } from 'next';
import { BulkQueryGenerator } from '@/components/BulkQueryGenerator';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'Bulk SQL Query Generator — Validation Queries from a CREATE TABLE',
  description:
    'Paste a CREATE TABLE or a list of fields and generate one SQL query per column. Variables resolve per data type, so date columns get date sentinels. Runs entirely in your browser.',
  alternates: {
    canonical: '/bulk-query-generator/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Paste Your DDL or Columns',
    description:
      'Paste a CREATE TABLE statement, an information_schema dump, or a simple list of column names into the left panel.',
  },
  {
    step: 2,
    title: 'Select a Query Template',
    description:
      'Choose a pre-built verification template (like table mismatch check) or customize your own SQL template with {{field}} tags.',
  },
  {
    step: 3,
    title: 'Copy or Export Queries',
    description:
      'Instantly copy the generated queries or download them as a SQL script or Excel workbook to run in your target database.',
  },
];

const FAQS = [
  {
    question: 'Why validate data column by column rather than using SELECT *?',
    answer:
      'On tables with millions of rows, comparing whole rows at once is slow, resource-heavy, and makes it hard to see which specific column failed. Column-by-column validation queries isolate the exact mismatch counts per field.',
  },
  {
    question: 'Does SQLParity send my table schemas or column names to a remote server?',
    answer:
      'No. The DDL parser and template engine execute 100% locally inside your browser tab. Your schema definitions never leave your machine.',
  },
  {
    question: 'How are NULL values handled in the comparison queries?',
    answer:
      'SQLParity automatically inserts dialect-specific null-safe sentinels (such as COALESCE or IS DISTINCT FROM) so that columns with NULL values do not report false differences.',
  },
  {
    question: 'What database dialects are supported for bulk generation?',
    answer:
      'It supports all 16 major dialects including PostgreSQL, MySQL, SQL Server (T-SQL), Snowflake, Google BigQuery, Amazon Redshift, Oracle, and ClickHouse.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <BulkQueryGenerator />
      <ToolFaqSection
        toolName="Bulk Query Generator"
        tagline="How to turn a table schema into validation queries for every column."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
