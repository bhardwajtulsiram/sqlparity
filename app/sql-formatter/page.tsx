import type { Metadata } from 'next';
import { SqlFormatterTool } from '@/components/SqlFormatterTool';

export const metadata: Metadata = {
  title: 'SQL formatter',
  description:
    'Format SQL for PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, BigQuery, Athena and more — keyword case, indentation, line width, leading or trailing commas. Runs entirely in your browser.',
};

export default function Page() {
  return <SqlFormatterTool />;
}
