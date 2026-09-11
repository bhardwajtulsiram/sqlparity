import type { Metadata } from 'next';
import { BulkQueryGenerator } from '@/components/BulkQueryGenerator';

export const metadata: Metadata = {
  title: 'Bulk SQL query generator',
  description:
    'Paste a CREATE TABLE or a list of fields and generate one SQL query per column. Variables resolve per data type, so date columns get date sentinels. Runs entirely in your browser.',
};

export default function Page() {
  return <BulkQueryGenerator />;
}
