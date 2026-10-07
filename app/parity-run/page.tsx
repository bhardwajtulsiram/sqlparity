import type { Metadata } from 'next';
import { toolMetadata } from '@/lib/seo';
import { ParityRunTool } from '@/components/ParityRunTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = toolMetadata({
  path: '/parity-run/',
  title: 'Parity Run — Compare Two Copies of a Table, Row by Row',
  description:
    'Compare two copies of a table row by row in your browser: missing and extra keys, duplicate keys, and per-column differences, with a downloadable sign-off report. CSV, Parquet and JSON. Nothing is uploaded.',
});

const STEPS = [
  {
    step: 1,
    title: 'Drop both copies',
    description:
      'Drop the copy you trust and the copy you are checking — CSV, TSV, Parquet or JSON. Both are read inside the tab; neither file is uploaded.',
  },
  {
    step: 2,
    title: 'Line them up',
    description:
      'Columns are paired by name, even when the case or underscores changed. A unique id column is suggested as the key; adjust the pairing, the key and how strictly values compare.',
  },
  {
    step: 3,
    title: 'Run, then sign off',
    description:
      'Get a verdict with every missing key, duplicate and differing value counted, then download a sign-off report with the file fingerprints and the exact SQL behind each figure.',
  },
];

const FAQS = [
  {
    question: 'How do I verify that a data migration copied every row correctly?',
    answer:
      'Export the source and target tables to CSV or Parquet and drop both into Parity Run. It matches rows on a key, then reports row-count differences, keys missing from either side, duplicate or empty keys, and how many matched rows hold a different value in each column — with examples of each.',
  },
  {
    question: 'Are my files uploaded anywhere?',
    answer:
      'No. Both files are read by a SQL engine compiled to WebAssembly, running inside your browser tab. The page’s Content Security Policy forbids requests to any other server, and the SHA-256 fingerprints in the report are computed locally too.',
  },
  {
    question: 'What if my table has no primary key?',
    answer:
      'Choose no key and Parity Run compares each side as a whole set of rows, counting duplicates. It then reports how many rows exist on one side and not the other, with examples, though it cannot say which column changed without a key to pair rows by.',
  },
  {
    question: 'What does the sign-off report contain?',
    answer:
      'A single HTML file with the verdict, both files identified by SHA-256 fingerprint, row and key counts, per-column differences, every comparison setting and every SQL statement that produced a figure. Example values are left out unless you include them, because they are real data. It prints cleanly to PDF.',
  },
  {
    question: 'Can it ignore differences that do not matter, like trailing spaces or rounding?',
    answer:
      'Yes: whitespace, letter case, empty text versus NULL, and a numeric tolerance can each be relaxed. Every relaxation is recorded in the result and the report, so a match is never stronger than what was actually compared.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <ParityRunTool />
      <ToolFaqSection
        toolName="Parity Run"
        tagline="How to prove two copies of a table hold the same data, without uploading either."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
