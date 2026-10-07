import Link from 'next/link';
import {
  ArrowRightIcon,
  CheckIcon,
  CodeIcon,
  EngineIcon,
  GlobeIcon,
  KeyIcon,
  NotEqualIcon,
  ParityIcon,
  ParityMark,
  ReportIcon,
  ShieldIcon,
} from '@/components/icons';
import { RequestCountCard } from '@/components/SiteNav';
import { Sql } from '@/components/Sql';
import { getTool, TOOL_GROUPS, toolsIn } from '@/components/tools';
import { DIRECTIVES, FRAME_ANCESTORS } from '@/lib/csp';
import { DIALECTS } from '@/lib/dialects';

/**
 * The home page tells one story, top to bottom: what the product proves, how a
 * migration check runs through the tools, why an infosec reviewer can trust it, and
 * the evidence it hands over at the end.
 *
 * The page is paper and everything holding SQL or data is a lit screen — the same
 * contrast as every tool page. The hero shows the product's own answer (a Parity Run
 * result and its sign-off report) rather than an illustration of one, and the
 * request counter in it is live.
 */

const CTA_PRIMARY =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-accent-500 to-accent-600 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_8px_20px_-8px_oklch(0.55_0.18_250/0.75),0_0_0_1px_oklch(0.46_0.16_250)] transition-colors hover:from-accent-600 hover:to-accent-700';
const CTA_SECONDARY =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-card)] font-semibold shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--surface-header)]';

/**
 * Full-bleed: the band runs to both edges of the window while its content stays in
 * the site's column. <main> caps the width for every other page; the home page's
 * bands step out of it rather than every page losing the cap.
 */
const BLEED = 'mx-[calc(50%-50vw)]';

/** A coloured span on the code surface. */
function C({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ color: `var(--syn-${color})` }}>{children}</span>;
}

export default function Home() {
  return (
    // The layout pads <main>; the home page runs its bands edge to edge instead.
    <div className="-mx-4 -mt-8 -mb-4 sm:-mx-6 sm:-mt-10">
      <Hero />
      <ProofStrip />
      <Workflow />
      <Toolkit />
      <SecurityBand />
      <ReportShowcase />
      <DialectWall />
      <FinalCta />
    </div>
  );
}

/* ----------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className={`${BLEED} relative overflow-hidden border-b border-[var(--border-card)]`}>
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-4 pt-12 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] lg:pt-20 lg:pb-24">
        <div>
          <h1 className="mt-2 text-[42px] leading-[1.02] font-bold tracking-[-0.035em] text-balance sm:text-[56px] lg:text-[60px]">
            Prove every row made it across.
          </h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-600 sm:text-[19px] dark:text-ink-300">
            Compare two copies of a table, convert queries and run them on real engines, and hand your reviewer a
            signed-off report. All inside your browser tab — your data is never uploaded.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/parity-run/" className={`${CTA_PRIMARY} h-12 px-5 text-[15px]`}>
              <ParityIcon className="size-4" />
              Run a parity check
            </Link>
            <Link href="/parity-run/#example" className={`${CTA_SECONDARY} h-12 px-5 text-[15px]`}>
              Try it with example data
            </Link>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-ink-500 dark:text-ink-400">
            {['No account, no upload', 'CSV, Parquet and JSON', 'Open source, AGPLv3'].map((fact) => (
              <li key={fact} className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[var(--signal)]" />
                {fact}
              </li>
            ))}
          </ul>
        </div>

        <HeroShot />
      </div>
    </section>
  );
}

/** The product's own answer: a Parity Run result, its report, and the live counter. */
function HeroShot() {
  return (
    <div className="relative pb-10 lg:pb-0">
      <div className="overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-raised)]">
        <div className="flex items-center gap-2 border-b border-[var(--border-card)] bg-[var(--surface-header)] px-4 py-2.5 text-[12.5px] text-ink-500 dark:text-ink-400">
          <span aria-hidden="true" className="flex gap-1.5">
            <i className="size-2.5 rounded-full bg-ink-300 dark:bg-ink-700" />
            <i className="size-2.5 rounded-full bg-ink-300 dark:bg-ink-700" />
            <i className="size-2.5 rounded-full bg-ink-300 dark:bg-ink-700" />
          </span>
          <span className="ml-1.5 font-medium text-ink-700 dark:text-ink-200">Parity Run</span>
          <span className="ml-auto hidden font-mono sm:inline">in this tab</span>
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 sm:gap-3">
            <FileCard kind="CSV" name="customers.csv" rows="12,480" columns="6" />
            <span className="flex size-11 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_12px_26px_-8px_oklch(0.63_0.22_25/0.8)] sm:size-14">
              <NotEqualIcon className="size-6 sm:size-7" />
            </span>
            <FileCard kind="PQ" name="customers_v2.parquet" rows="12,479" columns="7" />
          </div>

          <div className="mt-3.5 flex gap-3.5 rounded-xl border-2 border-red-400/50 bg-gradient-to-br from-red-500/[0.08] to-transparent p-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-red-500 text-white">
              <NotEqualIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[17px] font-semibold tracking-tight text-red-700 dark:text-red-300">Differences found</p>
              <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-600 dark:text-ink-300">
                <li>1 key in the source is missing from the target</li>
                <li>country: 38 matched rows hold a different value</li>
              </ul>
            </div>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['Keys matched', '12,478', false],
                ['Only in source', '1', true],
                ['Only in target', '0', false],
                ['Columns differ', '1', true],
              ] as const
            ).map(([label, value, bad]) => (
              <div
                key={label}
                className={`rounded-lg border px-2.5 py-2 ${bad ? 'border-red-300/70 dark:border-red-800/60' : 'border-[var(--border-card)]'}`}
              >
                <dt className="text-[10.5px] text-ink-500 dark:text-ink-400">{label}</dt>
                <dd className={`font-mono text-[17px] font-semibold ${bad ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 grid gap-2 rounded-xl p-3.5" style={{ background: 'var(--code-surface)' }}>
            {(
              [
                ['name', 0],
                ['email', 0],
                ['country', 38],
                ['lifetime_value', 0],
              ] as const
            ).map(([name, differ]) => (
              <div
                key={name}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 font-mono text-[12px] sm:grid-cols-[8rem_minmax(0,1fr)_4rem]"
              >
                <span style={{ color: 'var(--syn-identifier)' }}>{name}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <span
                    className="block h-full rounded-full"
                    style={
                      differ
                        ? { width: '6%', background: 'oklch(0.66 0.2 25)' }
                        : { width: '100%', background: 'var(--syn-string)', opacity: 0.5 }
                    }
                  />
                </span>
                <span className="text-right" style={{ color: differ ? 'oklch(0.8 0.12 25)' : 'var(--syn-comment)' }}>
                  {differ ? `${differ} rows` : 'match'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <RequestCountCard className="absolute top-[54%] -left-3 hidden sm:flex lg:-left-9" />

      <div className="absolute -right-2 -bottom-2 w-52 rotate-[2.2deg] rounded-2xl border border-[var(--border-card)] bg-white p-3.5 text-[#161a26] shadow-[var(--shadow-raised)] sm:w-60 lg:-right-6 lg:-bottom-12">
        <div className="flex items-center gap-1.5 border-b border-[#dfe3ea] pb-2 text-[10.5px] font-semibold">
          <ReportIcon className="size-3.5 text-[#2f6bde]" />
          SQLParity
          <span className="ml-auto font-normal text-[#5b6275]">Sign-off report</span>
        </div>
        <p className="mt-2 text-[13px] font-semibold">Customers — nightly sync check</p>
        <p className="mt-2 rounded-md border border-[#f3c3be] bg-[#fdecea] px-2 py-1 text-[11px] font-bold text-[#b42318]">
          Differences found
        </p>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[#5b6275]">
          source 4738cfd4c0eb69fd…
          <br />
          target d1cef7985d2510c8…
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-[8.5px] text-[#5b6275]">
          <span className="border-t border-[#161a26] pt-0.5">Reviewed by</span>
          <span className="border-t border-[#161a26] pt-0.5">Approved by</span>
        </div>
      </div>
    </div>
  );
}

function FileCard({ kind, name, rows, columns }: { kind: string; name: string; rows: string; columns: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--border-card)] p-2.5 sm:p-3">
      <p className="flex min-w-0 items-center gap-2 font-mono text-[11.5px] font-semibold sm:text-[13px]">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-[9.5px]"
          style={{ background: 'var(--code-surface)', color: 'var(--syn-string)' }}
        >
          {kind}
        </span>
        <span className="truncate">{name}</span>
      </p>
      <p className="mt-2 flex gap-4 text-[11px] text-ink-500 dark:text-ink-400">
        <span>
          Rows
          <b className="block font-mono text-[13px] text-ink-900 dark:text-ink-100">{rows}</b>
        </span>
        <span>
          Columns
          <b className="block font-mono text-[13px] text-ink-900 dark:text-ink-100">{columns}</b>
        </span>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------- proof strip */

/** Statements anyone can check — not logos or quotes the product has not earned. */
function ProofStrip() {
  const items = [
    { Icon: EngineIcon, title: 'Real SQL engines in the tab', line: 'Files are queried where they are, and converted SQL runs on real PostgreSQL and SQLite.' },
    { Icon: GlobeIcon, title: 'Sixteen SQL dialects', line: 'From PostgreSQL and SQL Server to Snowflake and BigQuery.' },
    { Icon: ShieldIcon, title: 'Enforced by the browser', line: 'The page is forbidden from contacting any other server.' },
    { Icon: CodeIcon, title: 'Open source', line: 'AGPLv3. Read it, run it, host it inside your network.' },
  ];
  return (
    <section className={`${BLEED} border-b border-[var(--border-card)] bg-[var(--surface-card)]`}>
      <ul className="mx-auto grid w-full max-w-7xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
        {items.map(({ Icon, title, line }, i) => (
          <li
            key={title}
            className={`flex items-start gap-3.5 py-5 pr-4 lg:py-6 ${i > 0 ? 'lg:border-l lg:border-[var(--border-card)] lg:pl-6' : ''}`}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-card)] bg-[var(--surface-header)] text-accent-600 dark:text-accent-400">
              <Icon className="size-5" />
            </span>
            <span>
              <span className="block text-[14px] font-semibold">{title}</span>
              <span className="mt-0.5 hidden text-[12.5px] leading-snug text-ink-500 sm:block dark:text-ink-400">{line}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- workflow */

function SectionHeading({ title, line, center = false }: { title: string; line: string; center?: boolean }) {
  return (
    <div className={`max-w-3xl ${center ? 'mx-auto text-center' : ''}`}>
      <h2 className="text-[30px] leading-[1.1] font-bold tracking-[-0.03em] text-balance sm:text-[40px]">{title}</h2>
      <p className="mt-4 text-[16px] leading-relaxed text-ink-500 sm:text-[17px] dark:text-ink-400">{line}</p>
    </div>
  );
}

function Workflow() {
  const steps = [
    {
      title: 'See what changed',
      tool: getTool('/schema-diff/'),
      line: 'Paste the old and new CREATE TABLE. Get every added, dropped and retyped column.',
      snippet: (
        <>
          <C color="string">+ signup_channel varchar</C>
          <br />
          <C color="number">~ total_spend int → bigint</C>
          <br />
          <C color="operator">− legacy_ref varchar</C>
          <br />
          <C color="comment">= customer_id varchar</C>
        </>
      ),
    },
    {
      title: 'Generate the checks',
      tool: getTool('/bulk-query-generator/'),
      line: 'One validation query per changed column, with the right NULL placeholder for each type.',
      snippet: (
        <Sql
          code={"-- 1 of 3\nSELECT 'total_spend', count(*)\nFROM input_db a\nJOIN output_db b ON …"}
          className="text-[11.5px] leading-relaxed"
        />
      ),
    },
    {
      title: 'Convert and run them',
      tool: getTool('/sql-converter/'),
      line: 'Move the checks to the target engine, then run them on real PostgreSQL or SQLite in the tab.',
      snippet: (
        <>
          <C color="comment">SQL Server → PostgreSQL</C>
          <br />
          <C color="string">✓</C> Runs on PostgreSQL 18
          <br />
          <C color="string">✓</C> Same answer as the original
          <br />
          <C color="comment">3 rows · 21 ms</C>
        </>
      ),
    },
    {
      title: 'Prove the data',
      tool: getTool('/parity-run/'),
      line: 'Drop both exports. Every row matched on its key, every difference counted, the report downloaded.',
      snippet: (
        <>
          <C color="string">= Match</C>
          <br />
          12,480 <C color="comment">rows against</C> 12,480
          <br />
          <C color="comment">7 columns, 0 differences</C>
          <br />
          <C color="number">report.html</C> <C color="comment">ready to sign</C>
        </>
      ),
    },
  ];

  return (
    <section id="how" className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 pt-24 sm:px-6 lg:pt-28">
      <SectionHeading
        title="One workflow, from schema to sign-off"
        line={'Each tool does one job on its own. Used together, they take you from "what changed?" to evidence your reviewer can sign.'}
      />
      <ol className="relative mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        <span
          aria-hidden="true"
          className="absolute top-[23px] right-[6%] left-[6%] hidden h-0.5 lg:block"
          style={{ background: 'linear-gradient(90deg, var(--border-strong), var(--color-accent-500) 60%, var(--signal))' }}
        />
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={step.title} className="relative flex flex-col">
              <span
                className={`flex size-12 items-center justify-center rounded-full border-2 font-mono text-[15px] font-semibold shadow-[0_0_0_7px_var(--surface-page)] ${
                  last
                    ? 'border-[var(--signal)] bg-[var(--signal)] text-white'
                    : 'border-[var(--border-strong)] bg-[var(--surface-card)] text-ink-600 dark:text-ink-300'
                }`}
              >
                {last ? <CheckIcon className="size-5" /> : i + 1}
              </span>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{step.title}</h3>
              <Link
                href={step.tool.href}
                className={`mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold hover:underline ${
                  last
                    ? 'text-[color-mix(in_oklab,var(--signal)_75%,black)] dark:text-[var(--signal)]'
                    : 'text-accent-700 dark:text-accent-400'
                }`}
              >
                <step.tool.Icon className="size-4" />
                {step.tool.name}
              </Link>
              <p className="mt-2.5 mb-4 flex-1 text-[14px] leading-relaxed text-ink-500 dark:text-ink-400">{step.line}</p>
              <div
                className="min-h-[7.5rem] rounded-xl border p-3.5 font-mono text-[11.5px] leading-relaxed"
                style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-plain)' }}
              >
                {step.snippet}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------- toolkit */

function Toolkit() {
  return (
    <section id="tools" className="mx-auto w-full max-w-7xl scroll-mt-24 px-4 pt-24 sm:px-6 lg:pt-28">
      <SectionHeading
        title="Every tool, grouped by the job"
        line="The same three groups as the Tools menu, so the page and the navigation teach one map of the product."
      />
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {TOOL_GROUPS.map((group) => (
          <div
            key={group.id}
            className="overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]"
          >
            <div className="border-b border-[var(--border-card)] bg-[var(--surface-header)] px-5 py-4">
              <h3 className="flex items-center gap-2.5 text-[15px] font-semibold">
                <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: group.color }} />
                {group.name}
              </h3>
              <p className="mt-0.5 text-[12.5px] text-ink-500 dark:text-ink-400">{group.blurb}</p>
            </div>
            <ul>
              {toolsIn(group.id).map((tool, i) => (
                <li key={tool.href} className={i > 0 ? 'border-t border-[var(--border-card)]' : ''}>
                  <Link href={tool.href} className="group flex items-start gap-3.5 px-5 py-4 transition-colors hover:bg-accent-500/[0.04]">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl border"
                      style={{ background: 'var(--code-surface)', borderColor: 'var(--code-border)', color: 'var(--syn-string)' }}
                    >
                      <tool.Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14.5px] font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-300">
                        {tool.name}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-500 dark:text-ink-400">{tool.summary}</span>
                    </span>
                    <ArrowRightIcon className="mt-3 size-4 shrink-0 text-ink-300 transition-all group-hover:translate-x-0.5 group-hover:text-accent-600 dark:text-ink-600 dark:group-hover:text-accent-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- security band */

function SecurityBand() {
  const mechanisms = [
    { Icon: ShieldIcon, title: 'The browser enforces it', line: 'A Content Security Policy forbids the page from contacting any other origin.' },
    { Icon: EngineIcon, title: 'Engines and fonts are served from this site', line: 'The SQL engines load from the same origin, and only when a tool needs them.' },
    { Icon: KeyIcon, title: 'No account, no cookies', line: 'Visits are counted without cookies. What you paste is never part of it.' },
    { Icon: CodeIcon, title: 'Self-host it', line: 'A static build you can run on an internal server, under AGPLv3.' },
  ];
  const shown = ['default-src', 'connect-src', 'font-src', 'worker-src', 'form-action'];
  const policy = [...DIRECTIVES.filter((d) => shown.includes(d.name)), FRAME_ANCESTORS];

  return (
    <section className={`${BLEED} screen-grid relative mt-24 overflow-hidden lg:mt-28`} style={{ backgroundColor: 'var(--code-surface)' }}>
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-24">
        <div>
          <h2 className="text-[30px] leading-[1.1] font-bold tracking-[-0.03em] text-balance text-white sm:text-[40px]">
            Built for data that is not allowed to leave the building
          </h2>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed sm:text-[17px]" style={{ color: 'oklch(0.8 0.015 265)' }}>
            Your infosec team does not have to take our word for it. Every guarantee below is a mechanism they can check in
            two minutes with the browser&apos;s developer tools.
          </p>
          <ul className="mt-8 space-y-4">
            {mechanisms.map(({ Icon, title, line }) => (
              <li key={title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.12] bg-white/[0.06] text-[var(--syn-string)]">
                  <Icon className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-[14.5px] font-semibold text-white">{title}</span>
                  <span className="block text-[13.5px] leading-relaxed" style={{ color: 'oklch(0.74 0.015 265)' }}>
                    {line}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div
          className="overflow-hidden rounded-2xl border shadow-[0_30px_60px_-24px_oklch(0_0_0/0.7)]"
          style={{ background: 'oklch(0.16 0.02 265)', borderColor: 'var(--code-border)' }}
        >
          <div
            className="flex items-center gap-2 border-b px-4 py-2.5 font-mono text-[12px]"
            style={{ borderColor: 'var(--code-border)', background: 'oklch(0.19 0.022 265)', color: 'var(--syn-comment)' }}
          >
            <span aria-hidden="true" className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
            </span>
            <span className="ml-1.5">Content-Security-Policy</span>
          </div>
          <pre className="code-scroll overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[1.8]">
            {policy.map((d) => (
              <span key={d.name} className="block">
                <C color="keyword">{d.name.padEnd(16)}</C>
                <C color="string">{d.value}</C>
                <C color="operator">;</C>
                {d.name === 'connect-src' && <C color="comment">{'   -- no request to any other server'}</C>}
              </span>
            ))}
          </pre>
          <div className="grid gap-1.5 border-t px-5 py-4 font-mono text-[12px]" style={{ borderColor: 'var(--code-border)', color: 'var(--syn-comment)' }}>
            {[
              ['Network — this session', 'origin'],
              ['/engines/pglite/pglite.wasm', 'this site'],
              ['/engines/sqlite/sqlite3.wasm', 'this site'],
              ['/_vercel/insights/view', 'this site'],
            ].map(([path, origin], i) => (
              <div key={path} className="grid grid-cols-[minmax(0,1fr)_5rem]">
                <span className="truncate" style={{ color: i === 0 ? undefined : 'var(--syn-plain)' }}>
                  {path}
                </span>
                <span>{origin}</span>
              </div>
            ))}
            <div
              className="mt-1.5 grid grid-cols-[minmax(0,1fr)_5rem] border-t border-dashed pt-2.5 text-[var(--syn-string)]"
              style={{ borderColor: 'var(--code-border)' }}
            >
              <span>Requests to other servers</span>
              <span>0</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- report showcase */

function ReportShowcase() {
  const points = [
    ['Reproducible.', 'Both files are identified by their SHA-256 fingerprint, with every setting and SQL statement printed.'],
    ['Honest.', 'A match on some columns is never called a match, and every relaxed comparison is listed.'],
    ['Private by default.', 'Example values are real data, so they stay out unless you include them.'],
  ];
  return (
    <section className="mx-auto grid w-full max-w-7xl items-center gap-14 px-4 pt-24 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-20 lg:pt-28">
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute inset-x-6 -bottom-3 h-8 rounded-b-2xl border border-[var(--border-card)] bg-white shadow-[var(--shadow-card)] dark:bg-[oklch(0.93_0.005_265)]"
        />
        <div className="relative rounded-2xl border border-[var(--border-card)] bg-white p-6 text-[#161a26] shadow-[var(--shadow-raised)] sm:p-8">
          <div className="flex items-center gap-2.5 border-b border-[#dfe3ea] pb-3.5 text-[13.5px] font-semibold">
            <ParityMark className="size-5" />
            SQLParity
            <span className="ml-auto text-[12px] font-normal text-[#5b6275]">Parity sign-off report</span>
          </div>
          <p className="mt-4 text-[21px] font-semibold tracking-tight">Customers — nightly sync check</p>
          <p className="text-[12px] text-[#5b6275]">Generated 2026-10-07 09:05 UTC · Prepared by Data platform team</p>
          <div className="my-4 rounded-xl border border-[#f3c3be] bg-[#fdecea] px-4 py-3.5 text-[#b42318]">
            <p className="text-[17px] font-bold">Differences found</p>
            <ul className="mt-1.5 list-disc pl-5 text-[12.5px] leading-relaxed text-[#161a26]">
              <li>1 key in the source is missing from the target.</li>
              <li>country: 38 matched rows hold a different value.</li>
            </ul>
          </div>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#f5f7fa] text-left text-[11px] text-[#5b6275]">
                <th className="px-2.5 py-1.5 font-semibold">Side</th>
                <th className="px-2.5 py-1.5 font-semibold">File</th>
                <th className="px-2.5 py-1.5 font-semibold">Rows</th>
                <th className="hidden px-2.5 py-1.5 font-semibold sm:table-cell">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Source', 'customers.csv', '12,480', '4738cfd4c0eb69fd163814c2d7a8…'],
                ['Target', 'customers_v2.parquet', '12,479', 'd1cef7985d2510c89a2cbe40d37d…'],
              ].map((row) => (
                <tr key={row[0]} className="border-b border-[#dfe3ea]">
                  <td className="px-2.5 py-1.5">{row[0]}</td>
                  <td className="px-2.5 py-1.5">{row[1]}</td>
                  <td className="px-2.5 py-1.5">{row[2]}</td>
                  <td className="hidden px-2.5 py-1.5 font-mono text-[10.5px] text-[#5b6275] sm:table-cell">{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-8 grid grid-cols-2 gap-7 text-[11px] text-[#5b6275]">
            <span className="border-t border-[#161a26] pt-1">Reviewed by, and date</span>
            <span className="border-t border-[#161a26] pt-1">Approved by, and date</span>
          </div>
        </div>
      </div>
      <div>
        <SectionHeading
          title="Hand your reviewer evidence, not a screenshot"
          line="Every Parity Run ends in a report someone can sign: one HTML file that prints cleanly to PDF and needs nothing to open."
        />
        <ul className="mt-7 space-y-4">
          {points.map(([title, line]) => (
            <li key={title} className="flex gap-3 text-[15px] leading-relaxed text-ink-600 dark:text-ink-300">
              <CheckIcon className="mt-1 size-[18px] shrink-0 text-[var(--signal)]" />
              <span>
                <b className="font-semibold text-ink-900 dark:text-white">{title}</b> {line}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/parity-run/#example" className={`${CTA_SECONDARY} mt-8 h-11 px-4 text-[14px]`}>
          <ReportIcon className="size-4" />
          See a report from example data
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- dialects */

function DialectWall() {
  const legend = [
    { sample: '"id"', color: 'identifier', label: 'How a name is quoted' },
    { sample: "''", color: 'string', label: 'How an apostrophe is escaped' },
    { sample: '\\\\', color: 'number', label: 'Backslashes must be doubled' },
  ];
  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-24 sm:px-6 lg:pt-28">
      <SectionHeading
        center
        title="Sixteen dialects that disagree about quoting"
        line="A wrong escape does not throw — it runs, and returns the wrong rows. So every dialect carries its own rules, and every rule is tested."
      />
      <dl className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-ink-600 dark:text-ink-400">
        {legend.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <dt
              className="flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 font-mono text-[12px]"
              style={{ background: 'var(--code-surface)', color: `var(--syn-${item.color})` }}
            >
              {item.sample}
            </dt>
            <dd>{item.label}</dd>
          </div>
        ))}
      </dl>
      <div
        className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border shadow-[var(--shadow-card)] sm:grid-cols-4 lg:grid-cols-8"
        style={{ background: 'var(--code-border)', borderColor: 'var(--code-border)' }}
      >
        {DIALECTS.map((dialect) => (
          <div key={dialect.id} className="min-w-0 bg-[var(--code-surface)] p-3.5 transition-colors hover:bg-[var(--code-header)]">
            <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--syn-plain)' }}>
              {dialect.label}
            </p>
            <p className="mt-2 flex flex-wrap gap-1 font-mono text-[11.5px]">
              <Token color="identifier">
                {dialect.identifier.open}name{dialect.identifier.close}
              </Token>
              <Token color="string">{dialect.quoteEscape === 'double' ? "''" : "\\'"}</Token>
              {dialect.backslashIsEscape && <Token color="number">{'\\\\'}</Token>}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Token({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded-[5px] px-1.5 py-0.5"
      style={{ color: `var(--syn-${color})`, background: 'oklch(1 0 0 / 0.05)', boxShadow: 'inset 0 0 0 1px oklch(1 0 0 / 0.07)' }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ final CTA */

function FinalCta() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 pt-24 pb-4 sm:px-6 lg:pt-28">
      <div className="relative flex flex-col gap-8 overflow-hidden rounded-3xl bg-gradient-to-br from-accent-600 via-[oklch(0.5_0.16_262)] to-[oklch(0.55_0.12_165)] px-6 py-12 text-white shadow-[0_30px_60px_-28px_oklch(0.5_0.18_255/0.8)] sm:px-12 lg:flex-row lg:items-center lg:py-14">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, oklch(1 0 0 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.07) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'linear-gradient(to left, black, transparent 70%)',
          }}
        />
        <div className="relative">
          <h2 className="text-[28px] font-bold tracking-[-0.03em] sm:text-[36px]">Start with your own two files</h2>
          <p className="mt-2 text-[16px] text-white/85">Nothing to install, nothing to sign up for. Close the tab and it is gone.</p>
        </div>
        <div className="relative flex flex-col gap-3 sm:flex-row lg:ml-auto">
          <Link
            href="/parity-run/"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-5 text-[15px] font-semibold text-accent-700 shadow-[0_8px_20px_-8px_oklch(0_0_0/0.4)] transition-colors hover:bg-white/90"
          >
            Run a parity check
          </Link>
          <Link
            href="/#tools"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/35 bg-white/10 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/15"
          >
            Browse all tools
          </Link>
        </div>
      </div>
    </section>
  );
}
