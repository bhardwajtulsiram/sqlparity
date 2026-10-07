import type { Metadata } from 'next';
import { QueryOptimizerTool } from '@/components/QueryOptimizerTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'SQL Query Optimizer — Find the Patterns That Make a Query Slow',
  description:
    'Review a SQL query for the patterns that make it scan more than it needs to — SELECT *, functions on filtered columns, leading-wildcard LIKE, NOT IN subqueries and more. Runs entirely in your browser.',
  alternates: {
    canonical: '/query-optimizer/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Paste Your Query',
    description:
      'Paste any SELECT or analytical SQL query that is running slowly or needs performance review.',
  },
  {
    step: 2,
    title: 'Choose Target Database',
    description:
      'Select your database engine so the optimizer evaluates engine-specific indexing and partition pruning rules.',
  },
  {
    step: 3,
    title: 'Inspect Anti-Pattern Warnings',
    description:
      'Review actionable warnings explaining why specific clauses scan more data than necessary and how to fix them.',
  },
];

const FAQS = [
  {
    question: 'What anti-patterns does SQLParity check for?',
    answer:
      'It checks for 9 common performance anti-patterns: functions on filtered columns (which break index sargability), SELECT * on wide analytical tables, leading-wildcard LIKE queries (%pattern), NOT IN subqueries containing nulls, missing WHERE clauses, and unpartitioned scans.',
  },
  {
    question: 'What does "functions on filtered columns break index pruning" mean?',
    answer:
      'Writing WHERE DATE(created_at) = "2026-01-01" forces the database engine to evaluate the DATE() function on every row instead of performing an index range seek. Rewriting it as WHERE created_at >= "2026-01-01" AND created_at < "2026-01-02" allows instant index pruning.',
  },
  {
    question: 'Does SQLParity need access to my database credentials or EXPLAIN plan?',
    answer:
      'No. It performs static SQL AST analysis directly in your browser. You never need to supply database passwords, connection strings, or internal table access.',
  },
  {
    question: 'Why avoid NOT IN with subqueries?',
    answer:
      'If the subquery returns even a single NULL value, standard SQL specifies that NOT IN evaluates to UNKNOWN/false for every row, often leading to unexpected zero results or costly table scans. Using NOT EXISTS is safer and faster.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <QueryOptimizerTool />
      <ToolFaqSection
        toolName="Query Optimizer"
        tagline="How to identify and eliminate expensive SQL query patterns that cause full table scans."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
