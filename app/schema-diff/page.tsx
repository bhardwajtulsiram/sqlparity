import type { Metadata } from 'next';
import { SchemaDiffTool } from '@/components/SchemaDiffTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = {
  title: 'Schema Diff — Compare Two CREATE TABLE Statements or Index Mappings',
  description:
    'Paste two CREATE TABLE statements and see exactly which columns were added, removed, or changed type — then generate correctness checks for only what changed.',
  alternates: {
    canonical: '/schema-diff/',
  },
};

const STEPS = [
  {
    step: 1,
    title: 'Paste Source DDL',
    description:
      'Paste your baseline or source database CREATE TABLE statement into the first editor panel.',
  },
  {
    step: 2,
    title: 'Paste Target DDL',
    description:
      'Paste your updated or destination CREATE TABLE definition into the second editor panel.',
  },
  {
    step: 3,
    title: 'Inspect Changes & Generate Checks',
    description:
      'Review color-coded column additions (+), deletions (-), and type changes (~), then generate queries for only what changed.',
  },
];

const FAQS = [
  {
    question: 'How does SQLParity detect column type changes?',
    answer:
      'The parser identifies type name aliases and precision changes (such as VARCHAR(50) to VARCHAR(255) or INT to BIGINT) and highlights type shifts that could cause data truncation.',
  },
  {
    question: 'Can I diff schemas from two different database engines?',
    answer:
      'Yes. You can paste a schema from SQL Server on the left and a schema from PostgreSQL or Snowflake on the right to compare equivalent column definitions across engines.',
  },
  {
    question: 'Is my proprietary schema uploaded or stored on any server?',
    answer:
      'No. The AST parser and diffing algorithm run purely in your browser tab. Your company table structures remain confidential.',
  },
  {
    question: 'Can I export the diff results for a pull request or code review?',
    answer:
      'Yes. You can copy the clean diff summary or copy validation queries directly into GitHub pull requests and Slack discussions.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <SchemaDiffTool />
      <ToolFaqSection
        toolName="Schema Diff"
        tagline="How to compare two database schemas and identify column discrepancies."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
