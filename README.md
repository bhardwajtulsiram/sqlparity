# SQLParity

Browser-only SQL tools for data-migration verification: bulk query generation, schema diffing,
value escaping, formatting, query review and dialect conversion.

Everything is computed in the browser. There is no backend, no account, and no upload — the column
names and identifiers you paste never leave your machine. The app builds to static files, so it can
be hosted anywhere.

## Tools

| Route | What it does |
| --- | --- |
| `/in-list-builder` | Paste a column of values, get a properly quoted and escaped `IN (…)` clause |
| `/bulk-query-generator` | One template plus a list of fields, one query per field |
| `/schema-diff` | Compare two `CREATE TABLE` statements, generate checks for what changed |
| `/sql-formatter` | Format SQL for 16 dialects |
| `/query-optimizer` | Review a query for the patterns that make it scan more than it needs to |
| `/sql-converter` | Translate quoting, escaping, row limits and function names between dialects |

## Running it

```bash
pnpm install
pnpm dev
```

Then open http://localhost:3000.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Static export to `out/` |
| `pnpm test` | Vitest suite |
| `pnpm typecheck` | `tsc --noEmit` |

`pnpm build` writes a fully static site to `out/`. Serve that directory from any static host.

## How it works

### Escaping

The riskiest thing this tool does is quote a string. A wrong escape does not throw — it produces
SQL that runs successfully and returns the wrong rows. Two flags per dialect in
[`lib/dialects.ts`](lib/dialects.ts) drive it:

- `quoteEscape` — `''` (standard) or `\'` (only where doubling is unsupported, e.g. BigQuery)
- `backslashIsEscape` — whether a literal backslash must be doubled (MySQL, BigQuery, Snowflake,
  Redshift, Hive, Spark, ClickHouse — but *not* Trino, PostgreSQL, T-SQL, Oracle, SQLite)

Order matters and is not interchangeable: backslashes are doubled **before** quotes are escaped.
Reversed, the backslash introduced by `\'` would itself be doubled, terminating the string early.
[`tests/escape.test.ts`](tests/escape.test.ts) covers this.

Numeric auto-detection deliberately treats `007` as a string. Emitted unquoted it would become `7`
and match the wrong rows.

### Reviewing and converting without a model

The comparable hosted tools do both of these by sending the query to a language model. That is a
reasonable product and not one this codebase can have, so both are rule-based — and both are
deliberately narrow about it.

[`lib/review.ts`](lib/review.ts) checks nine long-established anti-patterns, each carrying the
reason it costs something and a concrete fix. It cannot rank two queries by speed: without table
statistics, partition layout or indexes, nothing in the browser knows which is faster. The tool
says so on the page rather than implying otherwise.

[`lib/convert.ts`](lib/convert.ts) rewrites identifier quoting, string escaping, `LIMIT`/`TOP`/
`FETCH FIRST`, `CAST` type names, and functions that differ only in spelling. The important part is
the refusal list: a function may only be renamed when both spellings take the same arguments in the
same order. `CHARINDEX` and `STRPOS` look interchangeable and have theirs reversed; `DATEDIFF`
exists in several dialects with different units. Renaming those yields SQL that runs and returns
wrong rows, which is worse than SQL that fails — so they are reported as unconverted, with the
reason, and `convertSql` returns that list alongside the query.

### Typed variables

Template variables have three kinds:

- **constant** — filled once per run (`{{table_a}}`)
- **bulk** — iterates the pasted list (`{{field}}`)
- **typed** — resolved from each row's data type through a per-dialect map (`{{null_default}}`)

So `coalesce(a.{{field}}, {{null_default}})` produces `'1'` for a `varchar`, `-1` for a `bigint`,
and `TIMESTAMP '1900-01-01 00:00:00'` for a `timestamp`. The map is per dialect because Athena
needs the `TIMESTAMP` prefix and MySQL does not. Defaults live in [`lib/typemap.ts`](lib/typemap.ts)
and can be overridden globally.

A data type with no map entry **blocks generation** rather than falling back to a default. Emitting
a plausible sentinel for an unknown type would produce a query that runs cleanly and reports the
wrong answer, which is the worst outcome for a correctness tool.

### Token-aware replacement

Marking `customer_segment` as a variable must not rewrite
`customer_segment_range`, nor the same text inside a string literal or a comment.
[`lib/tokenize.ts`](lib/tokenize.ts) is a small string- and comment-aware scanner that answers
"is this position code?" — a regex cannot. The same scanner powers the leading-comma pass, since
`sql-formatter` has no comma-position option.

### Excel export

No formula escaping is applied, and that is deliberate. In OOXML a string cell and a formula cell
are different XML constructs, so Excel never reinterprets a leading `=` in a string cell.
Apostrophe-prefixing would corrupt every query that legitimately starts with a `--` comment.

Cells are capped below Excel's 32,767-character limit, with a visible truncation marker and a
pointer to the `.sql` download for the full text.

## Dependencies

| Package | Why |
| --- | --- |
| `next`, `react` | Static-export app |
| `sql-formatter` | Formatting, 16 dialects |
| `@codemirror/*` | Editor (~112 KB gz against Monaco's ~937 KB) |
| `write-excel-file` | `.xlsx` export (~19 KB gz) |
| `fflate` | Zip for the numbered `.sql` set |
| `dt-sql-parser` | ANTLR grammars behind DDL parsing and syntax validation |

## Not built yet

- **Share links.** Compressing the template and field list into a URL fragment via
  `CompressionStream`, so a query set can be handed to a colleague without a server.
  Tool-to-tool handoff already exists in [`lib/handoff.ts`](lib/handoff.ts), but that is
  sessionStorage inside one browser — a delivery between two tabs, not a link.

## Deliberately not done

These are settled decisions rather than a backlog. Each one was rejected because the
plausible implementation returns a confident wrong answer, which is the worst failure mode
for a correctness tool.

- **A "missing `LIMIT`" safety lint.** Aggregates and intentional full exports are common
  enough that it would cry wolf. [`lib/lint.ts`](lib/lint.ts) stays narrow — irreversible
  or table-wide statements only — and the query optimizer covers the scan-cost cases that
  are genuinely knowable from the text.
- **Ranking two queries by speed.** Without table statistics, partition layout or indexes,
  none of which are in the browser, nothing here can know which is faster.
- **Renaming functions whose arguments differ in order.** `CHARINDEX` against `STRPOS`, or
  `DATEDIFF` across dialects, would produce SQL that runs and returns the wrong rows.
  Reported as unconverted instead.
- **A data-type fallback for unknown types.** Generation blocks rather than emitting a
  plausible sentinel.

