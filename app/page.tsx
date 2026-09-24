import Link from 'next/link';
import { HeroDemo } from '@/components/HeroDemo';
import { CodeSurface, Sql } from '@/components/Sql';
import { DIALECTS } from '@/lib/dialects';

/**
 * The page is paper; everything holding SQL is a lit screen.
 *
 * That single contrast carries the design, so nothing else needs decorating. Each
 * tool is shown in its own material — the actual output it produces, syntax-coloured
 * by the same scanner the tools use — rather than an icon and an adjective. Six
 * identical cards would tell you there are six things; six different outputs tell you
 * what each one is for.
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

const CONVERTER_OUT = `SELECT "name", LENGTH("note")
FROM "sales"
LIMIT 10`;

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
    wide: true,
    // The flagship tile is twice as wide as the rest, so a query alone left it half
    // empty. Showing the rows it returns fills the space with the thing the tool is
    // for — a query and its answer — rather than with padding.
    preview: (
      <div className="text-[12.5px] leading-relaxed">
        <Sql code={SCRATCHPAD_QUERY} className="text-[12.5px] leading-relaxed" />
        <div
          className="mt-3 border-t pt-2.5"
          style={{ borderColor: 'var(--code-border)' }}
        >
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
    caption: "O'Brien Holdings · 007 · Müller GmbH",
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
        <Line color="var(--syn-comment)">
          a column inside a function cannot prune
        </Line>
      </div>
    ),
  },
  {
    href: '/sql-converter/',
    name: 'Dialect converter',
    line: 'Move a query between engines, with an explicit list of what it refused to guess at.',
    caption: 'SELECT TOP 10 [name], LEN([note]) FROM [sales]',
    preview: <Sql code={CONVERTER_OUT} className="text-[12.5px] leading-relaxed" />,
  },
];


export default function Home() {
  return (
    <div className="space-y-20 pb-10">
      <section className="pt-2 lg:pt-4">
        {/* The grid leads because it is the part that says what the product does. The
            page keeps an h1 for screen readers and search results, but not on screen:
            a visible headline counting the tools read as a sales line. */}
        <h1 className="sr-only">SQLParity — SQL tools that run in your browser</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-600 dark:text-ink-300">
          Built around one job: proving a migration copied every column correctly, without handing
          your table definitions to anyone. Everything runs in this tab.
        </p>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className={`group flex min-w-0 flex-col rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-card)] transition-colors hover:border-accent-500 ${
                tool.wide ? 'sm:col-span-2' : ''
              }`}
            >
              <h3 className="text-[15px] font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-400">
                {tool.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                {tool.line}
              </p>

              <div className="mt-5">
                <p className="mb-2 truncate font-mono text-[11.5px] text-ink-500 dark:text-ink-400">
                  {tool.caption}
                </p>
                <CodeSurface>
                  <div className="overflow-x-auto p-3.5">{tool.preview}</div>
                </CodeSurface>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-center lg:gap-12">
          <div>
            <h2 className="text-3xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-4xl">
              Your schema never leaves this tab.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-600 dark:text-ink-300">
              No account. No upload. No server to trust. Type in the box and watch the counter
              below it stay at zero — the claim is measured, not asserted.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/bulk-query-generator/"
                className="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-700"
              >
                Generate queries from a schema
              </Link>
              <Link
                href="/schema-diff/"
                className="rounded-lg border border-[var(--border-card)] bg-[var(--surface-card)] px-4 py-2.5 text-sm font-medium transition-colors hover:border-accent-500"
              >
                Compare two schemas
              </Link>
            </div>
          </div>

          <HeroDemo />
        </div>
      </section>

      <section>
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">
            Sixteen dialects that disagree about quoting
          </h2>
          <p className="mt-2 text-ink-600 dark:text-ink-400">
            The riskiest thing any of these tools does is quote a string. A wrong escape does not
            throw — it runs, and returns the wrong rows. So every dialect carries its own rules, and
            every rule is covered by tests.
          </p>
        </div>

        <CodeSurface className="mt-7">
          {/* gap-px over the border colour draws one hairline between cells, rather
              than a border per cell that doubles up and squares off at the edges. */}
          <div
            className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-4"
            style={{ background: 'var(--code-border)' }}
          >
            {DIALECTS.map((dialect) => (
              <div
                key={dialect.id}
                className="min-w-0 p-3.5"
                style={{ background: 'var(--code-surface)' }}
              >
                <p
                  className="truncate text-[12.5px] font-medium"
                  style={{ color: 'var(--syn-plain)' }}
                >
                  {dialect.label}
                </p>
                <p className="mt-2 font-mono text-[12.5px]">
                  <span style={{ color: 'var(--syn-identifier)' }}>
                    {dialect.identifier.open}name{dialect.identifier.close}
                  </span>
                  <span style={{ color: 'var(--syn-comment)' }}> · </span>
                  <span style={{ color: 'var(--syn-string)' }}>
                    {dialect.quoteEscape === 'double' ? "''" : "\\'"}
                  </span>
                  {dialect.backslashIsEscape && (
                    <span style={{ color: 'var(--syn-number)' }}> · {'\\\\'}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </CodeSurface>

        <p className="mt-3 font-mono text-[11.5px] text-ink-500 dark:text-ink-400">
          identifier quoting · how an apostrophe is escaped · whether a backslash must be doubled
        </p>
      </section>
    </div>
  );
}
