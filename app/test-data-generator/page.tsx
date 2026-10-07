import type { Metadata } from 'next';
import { toolMetadata } from '@/lib/seo';
import { TestDataTool } from '@/components/TestDataTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = toolMetadata({
  path: '/test-data-generator/',
  title: 'Test Data Generator — Realistic Rows and Edge Cases from a CREATE TABLE',
  description:
    'Generate test rows from a CREATE TABLE: apostrophes, emoji, right-to-left text, the longest value a column allows, leap days, DST gaps and the largest numbers a type holds. As SQL INSERTs, CSV or JSON Lines, in your browser.',
});

const STEPS = [
  {
    step: 1,
    title: 'Paste a CREATE TABLE',
    description:
      'From any of the 16 dialects. Column types, lengths, precision and NOT NULL are read from it, so every value fits the column it is for.',
  },
  {
    step: 2,
    title: 'Get rows that find the bugs',
    description:
      'The first rows walk each column through its traps — quotes, encodings, limits, awkward dates — each marked with the reason it is there. The rest are plausible values.',
  },
  {
    step: 3,
    title: 'Load it anywhere',
    description:
      'Download SQL INSERTs for your dialect, CSV or JSON Lines. Seed a test database, fill a staging table or feed a pipeline — and if the rows pass through two systems, compare both ends with Parity Run.',
  },
];

const FAQS = [
  {
    question: 'Which values does the Test Data Generator include?',
    answer:
      'For text: apostrophes, double quotes, backslashes, accented, Japanese and right-to-left text, emoji, leading and trailing spaces, an empty string next to NULL, the word NULL, embedded newlines and tabs, leading zeros, and the longest value the column allows. For numbers: zero, negatives and the largest and smallest values the type holds. For dates and times: a leap day, the Unix epoch, the 32-bit time limit and timestamps inside daylight-saving changes.',
  },
  {
    question: 'Is the same data generated every time?',
    answer:
      'Yes, for the same table definition, options and seed. That makes a failing row reproducible: keep the seed, and the exact rows can be generated again. Change the seed for a different set.',
  },
  {
    question: 'Will the SQL load into my database?',
    answer:
      'The INSERT statements are written for the dialect you choose — its identifier quoting, string escaping, date literals and boolean form. On SQL Server, text outside plain ASCII is written with an N prefix so it is not silently turned into question marks.',
  },
  {
    question: 'Is my table definition uploaded?',
    answer: 'No. The definition is read and the rows are generated inside your browser tab. Nothing is sent to a server.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <TestDataTool />
      <ToolFaqSection
        toolName="Test Data Generator"
        tagline="How to generate test rows that find the values your code mishandles."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
