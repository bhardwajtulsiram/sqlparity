import {
  BulkIcon,
  ConvertIcon,
  DiffIcon,
  FolderIcon,
  FormatIcon,
  GaugeIcon,
  InListIcon,
  ParityIcon,
  PlanIcon,
  ScratchpadIcon,
  TestDataIcon,
} from '@/components/icons';

/**
 * The jobs the tools are grouped by.
 *
 * One map of the product, used everywhere a list of tools appears — the Tools menu,
 * the home page, the footer and each tool page's breadcrumb — so a reader learns it
 * once. Ordered the way a data check runs: prove it, then the SQL around it.
 */
export type ToolGroupId = 'verify' | 'write' | 'explore';

export interface ToolGroup {
  id: ToolGroupId;
  name: string;
  /** One line on what the group is for. */
  blurb: string;
  /** A swatch for the group, so it is recognisable across the menu and the page. */
  color: string;
}

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'verify', name: 'Verify data', blurb: 'Prove two copies of a table match.', color: 'oklch(0.6 0.13 162)' },
  { id: 'write', name: 'Write and move SQL', blurb: 'Get a query right for the engine it runs on.', color: 'oklch(0.55 0.18 255)' },
  { id: 'explore', name: 'Explore and review', blurb: 'Look at data and queries before trusting them.', color: 'oklch(0.62 0.16 300)' },
];

/**
 * Every tool, once.
 *
 * The Tools menu, the command palette, the footer and each tool's own page header
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
  group: ToolGroupId;
  Icon: (props: { className?: string }) => React.ReactNode;
}

export const TOOLS: ToolInfo[] = [
  {
    href: '/parity-run/',
    label: 'Parity Run',
    name: 'Parity Run',
    summary: 'Prove two copies of a table hold the same data, row by row.',
    keywords: 'parity compare reconcile migration validate diff data csv parquet sign-off report audit',
    group: 'verify',
    Icon: ParityIcon,
  },
  {
    href: '/scratchpad/',
    label: 'Scratchpad',
    name: 'SQL Scratchpad',
    summary: 'Query a CSV or Parquet file with SQL, inside the tab.',
    keywords: 'duckdb csv parquet json run query file',
    group: 'explore',
    Icon: ScratchpadIcon,
  },
  {
    href: '/query-plan-visualizer/',
    label: 'Query Plan',
    name: 'Query Plan Visualizer',
    summary: 'See how a query runs, step by step, with the slowest step marked.',
    keywords: 'explain analyze query plan execution plan visualizer profile slow step join scan',
    group: 'explore',
    Icon: PlanIcon,
  },
  {
    href: '/in-list-builder/',
    label: 'IN List Builder',
    name: 'SQL IN List Builder',
    summary: 'Turn a column of values into a quoted, escaped IN clause.',
    keywords: 'in list values quote escape where',
    group: 'write',
    Icon: InListIcon,
  },
  {
    href: '/bulk-query-generator/',
    label: 'Bulk Generator',
    name: 'Bulk Query Generator',
    summary: 'One validation query per column, from a CREATE TABLE.',
    keywords: 'bulk generate template create table validation migration',
    group: 'verify',
    Icon: BulkIcon,
  },
  {
    href: '/schema-diff/',
    label: 'Schema Diff',
    name: 'Schema Diff',
    summary: 'See which columns were added, removed or changed type.',
    keywords: 'schema diff compare create table elasticsearch mapping',
    group: 'verify',
    Icon: DiffIcon,
  },
  {
    href: '/sql-formatter/',
    label: 'Formatter',
    name: 'SQL Formatter',
    summary: 'Format SQL for sixteen dialects, with a syntax check.',
    keywords: 'format beautify pretty indent lint',
    group: 'write',
    Icon: FormatIcon,
  },
  {
    href: '/query-optimizer/',
    label: 'Optimizer',
    name: 'Query Optimizer',
    summary: 'Find the shapes that make a query scan more than it needs to.',
    keywords: 'optimize review performance slow scan',
    group: 'explore',
    Icon: GaugeIcon,
  },
  {
    href: '/sql-converter/',
    label: 'Converter',
    name: 'SQL Converter',
    summary: 'Move a query between engines, with what needs a human.',
    keywords: 'convert translate dialect migrate engine',
    group: 'write',
    Icon: ConvertIcon,
  },
  {
    href: '/test-data-generator/',
    label: 'Test Data',
    name: 'Test Data Generator',
    summary: 'Realistic rows and the edge cases that break code, from a CREATE TABLE.',
    keywords: 'test data generator fake sample rows edge cases insert csv json fixtures seed',
    group: 'verify',
    Icon: TestDataIcon,
  },
  {
    href: '/bulk-sql-converter/',
    label: 'Bulk Converter',
    name: 'Bulk SQL Converter',
    summary: 'Format, convert or review every SQL file — and SQL in Excel or CSV cells — at once.',
    keywords: 'bulk batch folder directory many files dbt project format convert review lint zip excel xlsx csv spreadsheet',
    group: 'write',
    Icon: FolderIcon,
  },
];

/** The tools of one group, in menu order: the group's lead tool first. */
const ORDER = [
  '/parity-run/',
  '/schema-diff/',
  '/bulk-query-generator/',
  '/test-data-generator/',
  '/sql-converter/',
  '/sql-formatter/',
  '/in-list-builder/',
  '/bulk-sql-converter/',
  '/scratchpad/',
  '/query-plan-visualizer/',
  '/query-optimizer/',
];

export function toolsIn(group: ToolGroupId): ToolInfo[] {
  return TOOLS.filter((t) => t.group === group).sort((a, b) => ORDER.indexOf(a.href) - ORDER.indexOf(b.href));
}

export function getGroup(id: ToolGroupId): ToolGroup {
  return TOOL_GROUPS.find((g) => g.id === id)!;
}

export function getTool(href: string): ToolInfo {
  const tool = TOOLS.find((t) => t.href === href);
  if (!tool) throw new Error(`Unknown tool: ${href}`);
  return tool;
}
