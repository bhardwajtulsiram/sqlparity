import {
  BulkIcon,
  ConvertIcon,
  DiffIcon,
  FormatIcon,
  GaugeIcon,
  InListIcon,
  ScratchpadIcon,
} from '@/components/icons';

/**
 * Every tool, once.
 *
 * The header tabs, the command palette, the footer and each tool's own page header
 * all read from this list, so a tool is named and drawn the same way everywhere and
 * adding one is a single edit.
 */
export interface ToolInfo {
  href: string;
  /** Short enough for a tab. */
  label: string;
  /** The page title. */
  name: string;
  /** One sentence on what it does, for the palette and the footer. */
  summary: string;
  /** Extra words the command palette should match. */
  keywords: string;
  Icon: (props: { className?: string }) => React.ReactNode;
}

export const TOOLS: ToolInfo[] = [
  {
    href: '/scratchpad/',
    label: 'Scratchpad',
    name: 'SQL scratchpad',
    summary: 'Query a CSV or Parquet file with DuckDB, inside the tab.',
    keywords: 'duckdb csv parquet json run query file',
    Icon: ScratchpadIcon,
  },
  {
    href: '/in-list-builder/',
    label: 'IN list builder',
    name: 'SQL IN list builder',
    summary: 'Turn a column of values into a quoted, escaped IN clause.',
    keywords: 'in list values quote escape where',
    Icon: InListIcon,
  },
  {
    href: '/bulk-query-generator/',
    label: 'Bulk generator',
    name: 'Bulk query generator',
    summary: 'One validation query per column, from a CREATE TABLE.',
    keywords: 'bulk generate template create table validation migration',
    Icon: BulkIcon,
  },
  {
    href: '/schema-diff/',
    label: 'Schema diff',
    name: 'Schema diff',
    summary: 'See which columns were added, removed or changed type.',
    keywords: 'schema diff compare create table elasticsearch mapping',
    Icon: DiffIcon,
  },
  {
    href: '/sql-formatter/',
    label: 'Formatter',
    name: 'SQL formatter',
    summary: 'Format SQL for sixteen dialects, with a syntax check.',
    keywords: 'format beautify pretty indent lint',
    Icon: FormatIcon,
  },
  {
    href: '/query-optimizer/',
    label: 'Optimizer',
    name: 'Query optimizer',
    summary: 'Find the shapes that make a query scan more than it needs to.',
    keywords: 'optimize review performance slow scan',
    Icon: GaugeIcon,
  },
  {
    href: '/sql-converter/',
    label: 'Converter',
    name: 'SQL converter',
    summary: 'Move a query between engines, with what needs a human.',
    keywords: 'convert translate dialect migrate engine',
    Icon: ConvertIcon,
  },
];

export function getTool(href: string): ToolInfo {
  const tool = TOOLS.find((t) => t.href === href);
  if (!tool) throw new Error(`Unknown tool: ${href}`);
  return tool;
}
