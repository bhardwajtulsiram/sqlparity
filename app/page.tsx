import Link from 'next/link';
import { HeroDemo } from '@/components/HeroDemo';
import { ArrowRightIcon, ShieldIcon } from '@/components/icons';
import { CodeSurface, Sql } from '@/components/Sql';
import { getTool } from '@/components/tools';
import { DIALECTS } from '@/lib/dialects';

/**
 * The page is paper; everything holding SQL is a lit screen.
 *
 * That single contrast carries the design, so nothing else needs decorating. Each
 * tool is shown in its own material — the actual output it produces, syntax-coloured
 * by the same scanner the tools use — rather than an icon and an adjective. Six
 * identical cards would tell you there are six things; six different outputs tell you
 * what each one is for.
 *
 * The one place the page itself turns into a screen is the privacy band, because that
 * is the claim the product rests on and the demo inside it is how you test it.
 */

const BULK_QUERY = `-- 1 of 412, one per column in the CREATE TABLE
SELECT 'customer_segment' AS field, count(*) AS mismatches
FROM input_db a
JOIN output_db b ON a.customer_id = b.customer_id
WHERE coalesce(a.customer_segment, '~') <> coalesce(b.customer_segment, '~')`;

const SCRATCHPAD_QUERY = `SELECT segment, count(*) AS rows, avg(total) AS avg_total
FROM orders
WHERE created_at >= DATE '2026-01-01'
GROUP BY segment
ORDER BY rows DESC`;

const FORMATTER_OUT = `SELECT
    a.customer_id
  , a.customer_segment
FROM sales a
WHERE a.dt = DATE '2026-01-01'`;

const CONVERTER_IN = `SELECT TOP 10 [name], LEN([note])
FROM [sales]
WHERE [note] = 'O''Brien'`;

const CONVERTER_OUT = `SELECT "name", LENGTH(RTRIM("note"))
FROM "sales"
WHERE "note" = 'O''Brien'
LIMIT 10`;

/** One side of the converter tile: the engine it is written for, then the query. */
function Side({ label, code, dialectId }: { label: string; code: string; dialectId: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 font-mono text-[11px]" style={{ color: 'var(--syn-comment)' }}>
        {label}
      </p>
      <Sql code={code} dialectId={dialectId} className="text-[12.5px] leading-relaxed" />
    </div>
  );
}

/** A line of mono text on the code surface, for previews that are not SQL. */
function Line({ color = 'var(--syn-plain)', children }: { color?: string; children: React.ReactNode }) {
  return (
    <span className="block font-mono" style={{ color }}>
      {children}
    </span>
  );
}

/** A row of the little result grid in the scratchpad tile. */
function ResultRow({ cells, head = false }: { cells: string[]; head?: boolean }) {
  return (
    <div className="flex gap-6 font-mono">
      {cells.map((cell, i) => (
        <span
          key={cell}
          className={i === 0 ? 'w-24 shrink-0' : 'w-24 shrink-0 text-right'}
          style={{ color: head ? 'var(--syn-comment)' : 'var(--syn-plain)' }}
        >
          {cell}
        </span>
      ))}
    </div>
  );
}

const TOOLS = [
  {
    href: '/scratchpad/',
    name: 'SQL scratchpad',
    line: 'Drop in a CSV or Parquet file and query it with real SQL. DuckDB runs inside the tab, so the file is never uploaded.',
    caption: 'orders.csv — read off your disk, not uploaded',
    badge: 'DuckDB in the tab',
    span: 'sm:col-span-2',
    // The flagship tile is twice as wide as the rest, so a query alone left it half
    // empty. Showing the rows it returns fills the space with the thing the tool is
    // for — a query and its answer — rather than with padding.
    preview: (
      <div className="text-[12.5px] leading-relaxed">
        <Sql code={SCRATCHPAD_QUERY} className="text-[12.5px] leading-relaxed" />
        <div className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--code-border)' }}>
          <ResultRow cells={['segment', 'rows', 'avg_total']} head />
          <ResultRow cells={['enterprise', '1,284', '48,210.55']} />
          <ResultRow cells={['smb', '9,617', '3,905.20']} />
          <ResultRow cells={['unknown', '412', '1,120.00']} />
        </div>
      </div>
    ),
  },
  {
    href: '/bulk-query-generator/',
    name: 'Bulk query generator',
    line: 'One template plus a pasted column list becomes one validation query per field, with the right null placeholder for each data type.',
    caption: 'From one CREATE TABLE, 412 columns',
    preview: <Sql code={BULK_QUERY} className="text-[12.5px] leading-relaxed" />,
  },
  {
    href: '/schema-diff/',
    name: 'Schema diff',
    line: 'Compare the old and new definition, then check only what actually changed.',
    caption: 'old.sql against new.sql',
    preview: (
      <div className="text-[12.5px] leading-relaxed">
        <Line color="var(--syn-string)">+ signup_channel varchar</Line>
        <Line color="var(--syn-number)">~ total_spend int → bigint</Line>
        <Line color="var(--syn-operator)">− legacy_ref varchar</Line>
        <Line color="var(--syn-comment)">= customer_id varchar</Line>
      </div>
    ),
  },
  {
    href: '/in-list-builder/',
    name: 'IN list builder',
    line: 'A column of values becomes a correctly quoted clause — apostrophes, backslashes and leading zeros included.',
    caption: "O'Brien Holdings, 007, Müller GmbH",
    preview: (
      <Sql
        code={"IN (\n  'O''Brien Holdings',\n  '007',\n  'Müller GmbH'\n)"}
        className="text-[12.5px] leading-relaxed"
      />
    ),
  },
  {
    href: '/sql-formatter/',
    name: 'SQL formatter',
    line: 'Sixteen dialects, leading or trailing commas, and a syntax check as you type.',
    caption: "select a.customer_id,a.customer_segment from sales a where a.dt=date '2026-01-01'",
    preview: <Sql code={FORMATTER_OUT} className="text-[12.5px] leading-relaxed" />,
  },
  {
    href: '/query-optimizer/',
    name: 'Query optimizer',
    line: 'Nine checks for the shapes that scan more than they need to, each with the reason it costs something.',
    caption: "WHERE date(created_at) = '2026-01-01'",
    preview: (
      <div className="text-[12.5px] leading-relaxed">
        <Line color="var(--syn-number)">! the filter reads every partition</Line>
        <Line color="var(--syn-comment)">a column inside a function cannot prune</Line>
      </div>
    ),
  },
  {
    href: '/sql-converter/',
    name: 'Dialect converter',
    line: 'Move a query between engines, with an explicit list of what it refused to guess at.',
    caption: 'SQL Server to PostgreSQL',
    // Wide only at three columns: at two, the grid already closes evenly.
    span: 'lg:col-span-2',
    // Wide, so the last row of the grid closes rather than leaving a hole — and a
    // converter is the one tool whose output only means something next to its input.
    preview: (
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
        <Side label="SQL Server" code={CONVERTER_IN} dialectId="transactsql" />
        <ArrowRightIcon className="hidden size-4 text-[var(--syn-comment)] sm:block" />
        <Side label="PostgreSQL" code={CONVERTER_OUT} dialectId="postgresql" />
      </div>
    ),
  },
];

/** A key for the dialect wall, drawn in the same colours the tiles use. */
const LEGEND = [
  { sample: '"id"', color: 'var(--syn-identifier)', label: 'How a name is quoted' },
  { sample: "''", color: 'var(--syn-string)', label: 'How an apostrophe is escaped' },
  { sample: '\\\\', color: 'var(--syn-number)', label: 'Backslashes must be doubled' },
];

function Token({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded-[5px] px-1.5 py-0.5"
      style={{
        color,
        background: 'oklch(1 0 0 / 0.05)',
        boxShadow: 'inset 0 0 0 1px oklch(1 0 0 / 0.07)',
      }}
    >
      {children}
    </span>
  );
}

export default function Home() {
  return (
    <div className="space-y-20 pb-6 sm:space-y-24">
      <section>
        {/* The grid leads because it is the part that says what the product does. The
            page keeps an h1 for screen readers and search results, but not on screen:
            a visible headline counting the tools read as a sales line. */}
        <h1 className="sr-only">SQLParity — SQL tools that run in your browser</h1>
        <p className="max-w-4xl text-[20px] leading-[1.45] font-medium tracking-[-0.01em] sm:text-[23px]">
          Built around one job: proving a migration copied every column correctly.{' '}
          <span className="text-ink-500 dark:text-ink-400">
            Without handing your table definitions to anyone — everything runs in this tab.
          </span>
        </p>

        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => {
            const { Icon } = getTool(tool.href);
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={`group relative flex min-w-0 flex-col rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-200 hover:border-accent-500/60 hover:shadow-[var(--shadow-raised)] ${
                  tool.span ?? ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border"
                    style={{
                      background: 'var(--code-surface)',
                      borderColor: 'var(--code-border)',
                      color: 'var(--syn-string)',
                    }}
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <h3 className="text-[15.5px] font-semibold tracking-tight">{tool.name}</h3>
                  {tool.badge && (
                    <span className="hidden items-center gap-1.5 rounded-full bg-[var(--signal-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[color-mix(in_oklab,var(--signal)_70%,black)] ring-1 ring-[color-mix(in_oklab,var(--signal)_30%,transparent)] sm:inline-flex dark:text-[var(--signal)]">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--signal)]" />
                      {tool.badge}
                    </span>
                  )}
                  <ArrowRightIcon className="ml-auto size-4 shrink-0 -translate-x-1 text-accent-600 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 dark:text-accent-400" />
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                  {tool.line}
                </p>

                <div className="mt-5">
                  <CodeSurface>
                    {/* The title bar holds the input; the body is what the tool made of it. */}
                    <div
                      className="flex items-center gap-2 border-b px-3.5 py-2"
                      style={{ background: 'var(--code-header)', borderColor: 'var(--code-border)' }}
                    >
                      <span aria-hidden="true" className="flex shrink-0 gap-1">
                        <span className="size-2 rounded-full bg-white/15" />
                        <span className="size-2 rounded-full bg-white/15" />
                        <span className="size-2 rounded-full bg-white/15" />
                      </span>
                      <p
                        className="ml-1 truncate font-mono text-[11.5px]"
                        style={{ color: 'var(--syn-comment)' }}
                      >
                        {tool.caption}
                      </p>
                    </div>
                    <div className="code-scroll overflow-x-auto p-3.5">{tool.preview}</div>
                  </CodeSurface>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* The one lit band on the page: the claim, and a tool you can use to test it. */}
      <section
        className="screen-grid relative overflow-hidden rounded-3xl border px-5 py-10 shadow-[0_30px_60px_-30px_oklch(0.2_0.06_265/0.55)] sm:px-10 sm:py-14 lg:px-14"
        style={{ backgroundColor: 'var(--code-surface)', borderColor: 'var(--code-border)' }}
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:items-center lg:gap-14">
          <div>
            <span
              className="inline-flex size-11 items-center justify-center rounded-xl border"
              style={{
                borderColor: 'var(--code-border)',
                background: 'var(--code-header)',
                color: 'var(--syn-string)',
              }}
            >
              <ShieldIcon className="size-[22px]" />
            </span>
            <h2 className="mt-6 text-3xl leading-[1.08] font-semibold tracking-tight text-balance text-white sm:text-[40px]">
              Your schema never leaves this tab.
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed" style={{ color: 'var(--syn-plain)' }}>
              No account. No upload. No server to trust. Type in the box and watch the counter
              below it stay at zero — the claim is measured, not asserted.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/bulk-query-generator/"
                className="inline-flex h-10 items-center rounded-lg bg-gradient-to-b from-accent-500 to-accent-600 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_6px_18px_-6px_oklch(0.55_0.18_250/0.7)] transition-colors hover:from-accent-400 hover:to-accent-500"
              >
                Generate queries from a schema
              </Link>
              <Link
                href="/schema-diff/"
                className="inline-flex h-10 items-center rounded-lg border border-white/15 px-4 text-sm font-medium text-white transition-colors hover:bg-white/[0.06]"
              >
                Compare two schemas
              </Link>
            </div>
          </div>

          <HeroDemo />
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              Sixteen dialects that disagree about quoting
            </h2>
            <p className="mt-3 leading-relaxed text-ink-600 dark:text-ink-400">
              The riskiest thing any of these tools does is quote a string. A wrong escape does
              not throw — it runs, and returns the wrong rows. So every dialect carries its own
              rules, and every rule is covered by tests.
            </p>
          </div>

          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-600 dark:text-ink-400">
            {LEGEND.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <dt
                  className="flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 font-mono text-[12px]"
                  style={{ background: 'var(--code-surface)', color: item.color }}
                >
                  {item.sample}
                </dt>
                <dd>{item.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <CodeSurface className="mt-8 shadow-[var(--shadow-card)]">
          {/* gap-px over the border colour draws one hairline between cells, rather
              than a border per cell that doubles up and squares off at the edges. */}
          <div
            className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-4"
            style={{ background: 'var(--code-border)' }}
          >
            {DIALECTS.map((dialect) => (
              <div
                key={dialect.id}
                className="min-w-0 bg-[var(--code-surface)] p-4 transition-colors hover:bg-[var(--code-header)]"
              >
                <p className="truncate text-[13px] font-medium" style={{ color: 'var(--syn-plain)' }}>
                  {dialect.label}
                </p>
                <p className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[12px]">
                  <Token color="var(--syn-identifier)">
                    {dialect.identifier.open}name{dialect.identifier.close}
                  </Token>
                  <Token color="var(--syn-string)">
                    {dialect.quoteEscape === 'double' ? "''" : "\\'"}
                  </Token>
                  {dialect.backslashIsEscape && (
                    <Token color="var(--syn-number)">{'\\\\'}</Token>
                  )}
                </p>
              </div>
            ))}
          </div>
        </CodeSurface>
      </section>
    </div>
  );
}
