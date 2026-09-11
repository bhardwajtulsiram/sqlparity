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

const TOOLS = [
  {
    href: '/bulk-query-generator/',
    name: 'Bulk query generator',
    line: 'One template plus a pasted column list becomes one validation query per field, with the right null placeholder for each data type.',
    caption: 'From one CREATE TABLE, 412 columns',
    wide: true,
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
        <Line color="var(--syn-comment)">= customer_id varchar</Line>
      </div>
    ),
  },
  {
    href: '/in-list-builder/',
    name: 'IN list builder',
    line: 'A column of values becomes a correctly quoted clause — apostrophes, backslashes and leading zeros included.',
    caption: "O'Brien Holdings · 007",
    preview: <Sql code={"IN ('O''Brien Holdings', '007')"} className="text-[12.5px]" />,
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

const CHECKS = [
  {
    title: 'Open devtools, then type',
    body: 'Watch the Network tab while you paste a schema into any tool here. Nothing appears, because nothing is sent.',
  },
  {
    title: 'Turn off your network',
    body: 'Every tool keeps working. There is no request to fail, and the fonts are served from this same origin.',
  },
  {
    title: 'Clear this browser’s storage',
    body: 'Your settings and saved templates live in this browser and nowhere else. Clearing them is all it takes for the tool to forget everything you typed.',
  },
];

export default function Home() {
  return (
    <div className="space-y-20 pb-10">
      <section className="pt-2 lg:pt-4">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-center lg:gap-12">
          <div>
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
              Your schema never leaves this tab.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-600 dark:text-ink-300">
              Six tools for the work around a migration — generating the checks, diffing the
              definitions, escaping the values, formatting, reviewing and converting. Every one of
              them computes right here.
            </p>
            <p className="mt-3 text-lg leading-relaxed text-ink-600 dark:text-ink-300">
              No account. No upload. No server to trust.
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
        <h2 className="text-2xl font-semibold tracking-tight">Six tools, one workflow</h2>
        <p className="mt-2 max-w-2xl text-ink-600 dark:text-ink-400">
          Built around one job: proving a migration copied every column correctly, without handing
          your table definitions to anyone.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

              <div className="mt-5 sm:mt-auto sm:pt-5">
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

      <section className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-card)] p-8 shadow-[var(--shadow-card)]">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-12">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              The privacy claim is checkable, not a promise
            </h2>
            <p className="mt-4 text-ink-600 dark:text-ink-400">
              Every tool here is plain JavaScript running in your browser. Column names, table
              definitions and identifiers are read, transformed and displayed without a network
              request. You do not have to take that on faith — three ways to check it yourself:
            </p>
          </div>

          <ol className="grid gap-px overflow-hidden rounded-lg border border-[var(--border-card)] bg-[var(--border-card)]">
            {CHECKS.map((check, i) => (
              <li key={check.title} className="flex gap-4 bg-[var(--surface-card)] p-5">
                <span className="mt-0.5 font-mono text-sm text-ink-400 tabular-nums dark:text-ink-500">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{check.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                    {check.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
