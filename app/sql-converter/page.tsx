import type { Metadata } from 'next';
import { SqlConverterTool } from '@/components/SqlConverterTool';

export const metadata: Metadata = {
  title: 'SQL dialect converter',
  description:
    'Convert SQL between PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, BigQuery, Athena and more — quoting, string escaping, row limits and function names, with an explicit list of what needs a human. Runs entirely in your browser.',
};

export default function Page() {
  return <SqlConverterTool />;
}
