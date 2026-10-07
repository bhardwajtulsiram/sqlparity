import type { Metadata } from 'next';
import { toolMetadata } from '@/lib/seo';
import { BulkSqlConverterTool } from '@/components/BulkSqlConverterTool';
import { ToolFaqSection } from '@/components/ToolFaqSection';

export const metadata: Metadata = toolMetadata({
  path: '/bulk-sql-converter/',
  title: 'Bulk SQL Converter — Format, Convert or Review Every SQL File at Once',
  description:
    'Choose a folder of SQL files, a dbt project, or Excel and CSV files with SQL in their cells, and format, convert or review every query at once, in your browser. Results come back in the same format. Nothing is uploaded.',
});

const STEPS = [
  {
    step: 1,
    title: 'Choose a folder',
    description:
      'Drop a folder or pick files. Every SQL file in it and its sub-folders is read in the tab, and so is every Excel (.xlsx) or CSV cell that holds a query; dependency and build folders such as node_modules and dbt’s target are skipped.',
  },
  {
    step: 2,
    title: 'Format, convert or review',
    description:
      'Format every file with your formatter settings, convert them all from one dialect to another, or review them with the optimizer, the safety checks and a syntax check.',
  },
  {
    step: 3,
    title: 'Download the results',
    description:
      'Results come back in the format they went in, named for what was done: report.sql formatted is formatted_report.sql, and a workbook comes back as a workbook with only its SQL cells changed. A folder comes back as one zip laid out like it — or, in Chrome and Edge, written straight into a folder you choose. A review downloads as CSV or copies as Markdown for a pull request.',
  },
];

const FAQS = [
  {
    question: 'Does it change the files in my folder?',
    answer:
      'No. Files are read, never written over. The results come back as new files named for what was done, such as formatted_report.sql, so the originals stay exactly as they were and a conversion you do not like costs nothing.',
  },
  {
    question: 'Can it find SQL inside Excel or CSV files?',
    answer:
      'Yes. Every cell of an .xlsx, .xlsm, .csv or .tsv file is read, and a cell counts as SQL when it starts with a statement — SELECT, WITH, INSERT, UPDATE, DELETE, MERGE, CREATE and so on — written the way SQL is, so a note such as “Select the rows below” is left alone. Formulas are never touched. The workbook comes back with only those cells changed: other cells, sheets, styles and macros stay as they were. Older .xls files must be saved as .xlsx first.',
  },
  {
    question: 'What does Save to folder do?',
    answer:
      'In Chrome and Edge, instead of downloading a zip you can pick a folder on your computer and the results are written into a new folder inside it — formatted_reports, say — laid out like the original. Nothing already in the folder is overwritten. Other browsers do not let a page write to a folder, so there the results download as a zip.',
  },
  {
    question: 'Can I format a whole dbt project?',
    answer:
      'Yes. Choose the project folder: models, macros and tests are all read, Jinja such as {{ ref(...) }} and {{ var(...) }} is kept intact, and dbt’s target and dbt_packages folders are skipped.',
  },
  {
    question: 'Is any of my SQL uploaded?',
    answer:
      'No. The folder is read by your browser and every file is processed inside the tab by the same code as the single-query tools. Nothing is sent to a server.',
  },
  {
    question: 'How many files can it handle?',
    answer:
      'Hundreds at a time; it works through them with a progress bar rather than freezing the page. Files over 1 MB are listed and left out, because formatting a database dump that size would lock the tab.',
  },
];

export default function Page() {
  return (
    <div className="space-y-12">
      <BulkSqlConverterTool />
      <ToolFaqSection
        toolName="Bulk SQL Converter"
        tagline="How to format, convert or review a whole folder of SQL at once."
        steps={STEPS}
        faqs={FAQS}
      />
    </div>
  );
}
