import type { Metadata } from 'next';
import { QueryOptimizerTool } from '@/components/QueryOptimizerTool';

export const metadata: Metadata = {
  title: 'SQL query optimizer',
  description:
    'Review a SQL query for the patterns that make it scan more than it needs to — SELECT *, functions on filtered columns, leading-wildcard LIKE, NOT IN subqueries and more. Runs entirely in your browser.',
};

export default function Page() {
  return <QueryOptimizerTool />;
}
