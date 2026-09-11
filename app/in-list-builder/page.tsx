import type { Metadata } from 'next';
import { InListBuilder } from '@/components/InListBuilder';

export const metadata: Metadata = {
  title: 'SQL IN list builder',
  description:
    'Paste a column of values and get a properly quoted, escaped IN (...) clause for PostgreSQL, MySQL, SQL Server, BigQuery, Athena and more. Runs entirely in your browser.',
};

export default function Page() {
  return <InListBuilder />;
}
