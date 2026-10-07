import type { Metadata } from 'next';
import { toolMetadata } from '@/lib/seo';
import { SqlScratchpadTool } from '@/components/SqlScratchpadTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = toolMetadata({
  path: '/query-plan-visualizer/',
  title: 'Query Plan Visualizer — EXPLAIN ANALYZE as Steps You Can Read',
  description:
    'See how a SQL query runs: every step of its execution plan with the rows it produced and the time it took, the slowest step marked, and notes on joins and scans that do too much. Runs on your CSV or Parquet files, in your browser. Nothing is uploaded.',
});

/** Something with a join, a group and a sort, so Explain has a plan worth reading before any file is dropped. */
const STARTER = `-- Press Explain to see how this query runs, step by step.
-- Or drop a CSV or Parquet file and explain a query on your own data.
WITH orders AS (
  SELECT i AS id, i % 500 AS customer_id, (i * 37) % 1000 AS amount
  FROM range(200000) t(i)
),
customers AS (
  SELECT i AS id, 'customer ' || i AS name
  FROM range(500) t(i)
)
SELECT c.name, count(*) AS orders, sum(o.amount) AS total
FROM orders o
JOIN customers c ON c.id = o.customer_id
GROUP BY c.name
ORDER BY total DESC
LIMIT 10`;

const STEPS = [
  {
    step: 1,
    title: 'Write or paste a query',
    description:
      'Start from the example, or drop a CSV, Parquet or JSON file — it becomes a table you can query. The file is read inside the tab.',
  },
  {
    step: 2,
    title: 'Press Explain',
    description:
      'The query runs once with profiling on. Only a single statement that reads data is explained, because profiling really runs it.',
  },
  {
    step: 3,
    title: 'Read the plan',
    description:
      'Each step in plain words — scan, filter, join, group, sort — with the rows it produced, its own time and its share of the total. The slowest step is marked, with notes on what made it slow.',
  },
];

const FAQS = [
  {
    question: 'What is a query plan?',
    answer:
      'The steps a database takes to answer a query: which tables it reads, in what order it joins them, where it filters, groups and sorts. EXPLAIN shows the plan; EXPLAIN ANALYZE also runs the query and records how many rows and how much time each step took — which is what this shows.',
  },
  {
    question: 'How do I find why a query is slow?',
    answer:
      'Press Explain and look at the step marked slowest, then at the notes beside it. The usual causes are flagged for you: a join that compares every row with every row, a scan that reads far more rows than it keeps, and row estimates more than ten times off. The Query Optimizer’s findings for the same query are shown alongside.',
  },
  {
    question: 'Can I paste a plan from my own database?',
    answer:
      'Not yet. The plan comes from running the query in the SQL engine inside this tab, on files you drop in. That keeps your data on your machine, but it means a query against your production database has to be run on an export of the tables it reads.',
  },
  {
    question: 'Is my data uploaded?',
    answer: 'No. The files are read by your browser and the query runs inside the tab. Nothing is sent to a server.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <SqlScratchpadTool
        href="/query-plan-visualizer/"
        description="Press Explain and see how a query runs: every step of its plan in plain words, with the rows it produced and the time it took, the slowest step marked and notes on what made it slow. Runs on your own CSV or Parquet files, inside this tab — nothing is uploaded."
        starter={STARTER}
      />
      <ToolFaqSection
        toolName="Query Plan Visualizer"
        tagline="How to read a query plan and find the step that makes a query slow."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
