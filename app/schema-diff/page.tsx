import type { Metadata } from 'next';
import { SchemaDiffTool } from '@/components/SchemaDiffTool';

export const metadata: Metadata = {
  title: 'Schema diff',
  description:
    'Paste two CREATE TABLE statements and see exactly which columns were added, removed, or changed type — then generate correctness checks for only what changed.',
};

export default function Page() {
  return <SchemaDiffTool />;
}
