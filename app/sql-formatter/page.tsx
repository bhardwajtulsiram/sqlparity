import type { Metadata } from 'next';
import { SqlFormatterTool } from '@/components/SqlFormatterTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'SQL formatter',
  description:
    'Format SQL for PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, BigQuery, Athena and more — keyword case, indentation, line width, leading or trailing commas. Runs entirely in your browser.',
  alternates: {
    canonical: '/sql-formatter/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Paste Your Query',
    description:
      'Paste any raw, unformatted, or single-line SQL query into the left code editor.',
  },
  {
    step: 2,
    title: 'Select Dialect & Casing',
    description:
      'Choose your database engine, keyword case (UPPERCASE or lowercase), and preferred comma position (leading or trailing).',
  },
  {
    step: 3,
    title: 'Copy Clean SQL',
    description:
      'Inspect the beautifully indented output with syntax highlighting and copy it directly to your clipboard.',
  },
];

const FAQS = [
  {
    question: 'Why choose leading commas over trailing commas?',
    answer:
      'Leading commas (placing commas at the beginning of each selected line) make it easy to comment out or reorder columns in code without leaving a trailing syntax error. SQLParity supports both styles with one toggle.',
  },
  {
    question: 'Does the formatter validate syntax as I type?',
    answer:
      'Yes. SQLParity runs dialect-specific validation checks as you type to highlight syntax mistakes, unclosed parentheses, and unescaped quotes before you run the query.',
  },
  {
    question: 'How many database dialects are supported?',
    answer:
      '16 engines are supported: PostgreSQL, MySQL, SQLite, SQL Server (T-SQL), Oracle, MariaDB, Snowflake, BigQuery, Redshift, Trino/Athena, Spark SQL, Hive, ClickHouse, DuckDB, IBM Db2, and Standard SQL.',
  },
  {
    question: 'Are my company queries or table names sent to a backend server?',
    answer:
      'No. The formatting engine operates 100% inside your browser tab. No database credentials, table names, or queries are ever transmitted over the network.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <SqlFormatterTool />
      <ToolFaqSection
        toolName="SQL Formatter"
        tagline="How to format, indent, and beautify queries across 16 SQL dialects."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
