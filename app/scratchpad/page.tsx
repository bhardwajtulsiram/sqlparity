import type { Metadata } from 'next';
import { SqlScratchpadTool } from '@/components/SqlScratchpadTool';

export const metadata: Metadata = {
  title: 'SQL scratchpad — query a CSV or Parquet file',
  description:
    'Run real SQL against your own CSV, TSV, Parquet or JSON file. DuckDB runs inside the browser tab, so the file is never uploaded — no account, no server, nothing leaves your machine.',
};

export default function Page() {
  return <SqlScratchpadTool />;
}
