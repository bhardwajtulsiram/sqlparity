import type { Metadata } from 'next';
import { SqlScratchpadTool } from '@/components/SqlScratchpadTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'SQL Scratchpad — Query CSV and Parquet Files in Your Browser',
  description:
    'Run real SQL against your own CSV, TSV, Parquet or JSON file. The SQL engine runs inside the browser tab, so the file is never uploaded — no account, no server, nothing leaves your machine.',
  alternates: {
    canonical: '/scratchpad/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Drop in a Data File',
    description:
      'Drag and drop any CSV, TSV, Parquet, or JSON Lines file from your computer into the SQL Scratchpad drop zone.',
  },
  {
    step: 2,
    title: 'Run Real SQL Queries',
    description:
      'Your file is registered as a table automatically. Write queries with aggregations, CTEs, window functions, and joins.',
  },
  {
    step: 3,
    title: 'Inspect & Export Results',
    description:
      'Browse query results in the table viewer, sort columns, and export data subsets back to CSV or TSV with one click.',
  },
];

const FAQS = [
  {
    question: 'How does a SQL engine run inside a web browser tab?',
    answer:
      'The engine is compiled into WebAssembly (WASM). It executes directly within your browser’s virtual machine, reading file bytes from your local disk into memory without requiring any server infrastructure.',
  },
  {
    question: 'Is my data file uploaded to any remote server or cloud bucket?',
    answer:
      'No. The browser File System API loads the file into local memory only. The page’s Content Security Policy strictly blocks network requests, ensuring total privacy for sensitive datasets.',
  },
  {
    question: 'What is the file size limit for Parquet and CSV files?',
    answer:
      'The limit depends on your computer’s available RAM. Files up to several hundred megabytes (and hundreds of thousands of rows) query smoothly in seconds.',
  },
  {
    question: 'Can I drop multiple files and join them with SQL?',
    answer:
      'Yes. Each file you drop becomes a distinct table named after the filename (e.g., dropping orders.csv and customers.parquet lets you run SELECT * FROM orders JOIN customers ON ...).',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <SqlScratchpadTool />
      <ToolFaqSection
        toolName="SQL Scratchpad"
        tagline="How to inspect, query, and analyze CSV and Parquet files in your browser tab."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
