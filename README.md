# SQLParity

Browser-only SQL tools for data-migration verification: querying a local file, bulk query
generation, schema diffing, value escaping, formatting, query review and dialect conversion.

Everything is computed in the browser. There is no backend, no account, and no upload — the column
names and identifiers you paste never leave your machine. The app builds to static files, so it can
be hosted anywhere.

## Tools

| Route | What it does |
| --- | --- |
| `/scratchpad` | Drop in a CSV or Parquet file and query it with real SQL, via DuckDB compiled to WebAssembly |
| `/in-list-builder` | Paste a column of values, get a properly quoted and escaped `IN (…)` clause |
| `/bulk-query-generator` | One template plus a list of fields, one query per field |
| `/schema-diff` | Compare two `CREATE TABLE` statements or two Elasticsearch index mappings |
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

### Running SQL without a server

`/scratchpad` runs [DuckDB compiled to WebAssembly](https://duckdb.org/2021/10/29/duckdb-wasm)
inside the tab. A dropped file is registered with `BROWSER_FILEREADER`, so the engine streams it
straight off disk — a Parquet file larger than memory stays queryable and nothing is copied.

Two decisions in [`scripts/copy-duckdb.mjs`](scripts/copy-duckdb.mjs) are worth keeping:

- **Served from this origin, not a CDN.** The published bundles point at jsDelivr, which would be
  one line shorter and would also be the single outbound request this product claims not to make.
  The counter on the home page measures exactly that and would turn red.
- **Copied at build time, not committed.** The runtime is 75 MB against a repository under half a
  megabyte. `pnpm` reproduces it exactly from the lockfile, so `public/duckdb/` is gitignored.

The `coi` bundle is deliberately absent: it needs COOP/COEP headers a static host may not let you
set, and buys threads this workload does not need.

The honest limits. This is DuckDB, so its SQL is close to PostgreSQL and Athena or T-SQL specifics
will not run — it is for checking that logic is right against sample rows, not for reaching a
warehouse. The engine is a 7.7 MB download, deferred until the first query rather than paid on page
load. And DuckDB does not error on a malformed CSV; it quietly falls back to one wide column, or
drops rows that do not fit and names the rest `column0`, `column1`. Both tells are detected in
[`lib/scratchpad.ts`](lib/scratchpad.ts) and reported, because a table that loads successfully
while missing rows is the exact failure this project exists to refuse.

Real exports need more than that, and [`loadTable`](lib/duckdb.ts) handles what they bring:

- **A late value that does not fit.** DuckDB guesses types from a sample, so `N/A` on line
  30,002 of a numeric column failed the whole load. The file is re-read with every row used to
  settle the types, and the note names the line, the value and the column.
- **European numbers.** A column that is all `1,5`-style values in a semicolon-separated file is
  reloaded with a comma as the decimal point. Thousands separators (`1,234.56`) stay text, with
  the cast to use.
- **Ambiguous dates.** When `03/04/2026` could be either day or month first, the note says which
  was assumed and gives the statement that reloads the file the other way round.
- **One bad file in a batch.** Each file loads on its own, so a failure is reported next to the
  file list and the others still arrive — and still appear in it.

### The result grid

`Ctrl`/`Cmd`+`Enter` runs the query. That is bound inside CodeMirror rather than on the window,
and the reason is worth keeping: `defaultKeymap` binds `Mod-Enter` to `insertBlankLine`, which
runs on the editor element while the event is still bubbling — so a `preventDefault` further up
arrives after the blank line has been inserted. The window listener is still there for when focus
is outside the editor, but it ignores an event the editor already handled, or the query runs
twice.

Rows are numbered, and the number column pins to the left edge: knowing which row you are looking
at matters most when a wide result has been scrolled sideways. It is a display aid rather than
part of the result, so **Copy as TSV** gives the columns the query actually returned and no
phantom index column. It follows PostgreSQL's COPY text format, which its escaping already did:
a NULL is `\N`, so it cannot be mistaken for the text `NULL` or for an empty string.

Two different caps, which are easy to confuse:

- **2,000 rows are copied out of Arrow** ([`lib/duckdb.ts`](lib/duckdb.ts)). DuckDB answers
  `SELECT * FROM a_ten_million_row_parquet` almost instantly; it is turning those rows into
  JavaScript that locks the tab.
- **500 of those are rendered** ([`lib/scratchpad.ts`](lib/scratchpad.ts)).

The row count reported is neither of those — it comes from Arrow's own metadata, so a query that
produced 50,000 rows says 50,000 while showing 500.

Measured limits, so nobody has to rediscover them. A 500,000 row CSV loads in about 3 seconds and
`SELECT *` over it answers in under half a second, showing 500 rows and reporting 500,000. At 5
million rows it still shows 500 and still reports the real count, but the tab freezes for about
three seconds and the heap reaches roughly 650 MB.

The cause is that `connection.query` pulls the whole result into an Arrow table before either cap
applies — the caps bound what becomes JavaScript and what reaches the DOM, not what the engine
hands over. `connection.send` would stream it and keep memory flat, at the cost of Arrow's row
count, which would then need a separate `count(*)`. Left alone deliberately: the sizes this tool
is actually for are comfortable, and the honest row count is worth more than a faster worst case.

**Download CSV** asks DuckDB to write the file with `COPY ... TO`, so it holds every row rather
than the 500 on screen — assembling it from the rendered rows would hand back a fraction of a
large result without saying so. It re-runs the statement that produced the visible result, not
whatever the editor holds now, or editing the query without running it would download data the
table never showed. `COPY` can only wrap one query, so several statements at once, or something
that is not a `SELECT`, falls back to building the file from the rows in hand and says when that
means fewer of them.

CSV has no NULL, so an unquoted empty field is null and a quoted one is the empty string — the
convention PostgreSQL's own CSV export uses. Lines end LF on both paths.

Values are converted on the way out of Arrow, where the column type is still known, because
several types arrive in a shape that is wrong to print. A `DECIMAL` comes through as its unscaled
integer, so `1.005` would render as `1005`; a `DATE` arrives as epoch milliseconds. The conversion
keys on the Arrow format's numeric type ids rather than class names, which a production build is
free to mangle.

Some types cannot be repaired that way, because something is already lost when they reach
JavaScript: a `TIMESTAMP` loses its microseconds, `TIME` is a raw microsecond count, `INTERVAL` is
garbled, and a list or struct arrives with every decimal unscaled and every date an epoch number.
For those, the query is described first — `DESCRIBE` plans it without running it — and the
affected columns are cast to text inside DuckDB with `SELECT * REPLACE (…)`, which gets every one of
them right. Only read-only statements are wrapped, and a result with duplicate column names is left
as it is.

### Completion

The editors offer keyword completion, and on the scratchpad the names of whatever you have
loaded. The schema comes from the tables DuckDB actually holds, not from parsing the SQL, so a
suggested column always exists — suggesting a name that does not is worse than suggesting
nothing. With exactly one table loaded its columns complete unprefixed; with several, only
`table.` does, because a bare name then belongs to no particular table and picking one would
put the wrong table's columns a keystroke away.

Two details in [`components/SqlEditor.tsx`](components/SqlEditor.tsx) are load-bearing:

- **Tab accepts, not Enter.** CodeMirror's default binds Enter, which in a SQL editor means
  pressing Enter for a newline can silently insert a keyword. Tab falls through to normal focus
  movement when no popup is open, so keyboard users are not trapped.
- **The language extension lives in a Compartment.** Dropping a second file swaps the schema in
  place; rebuilding the editor would throw away undo history and the cursor.

The bulk generator's template editor deliberately has completion off — it is full of
`{{placeholders}}`, where a completion list over a half-typed variable name is noise.

### Enforcing the privacy claim

Nothing leaves the tab because of how the code is written. That is a weaker guarantee than the
browser refusing to allow otherwise, so the pages ship a Content Security Policy whose important
line is `connect-src 'self'`: this origin may not open a request to any other. A dependency that
turned malicious in a future update still could not send a schema anywhere.

Verified rather than assumed — `fetch`, `XMLHttpRequest`, `sendBeacon`, an image pixel and an
injected remote script were all blocked, with a `securitypolicyviolation` event naming
`connect-src`, while same-origin requests kept working. Note that `sendBeacon` returns `true` even
when blocked: it reports that the request was queued, not that it was delivered, so the violation
event is the signal to trust.

Two details that are easy to get wrong:

- It must be `<meta http-equiv>`. Next's `metadata.other` emits `name=`, which browsers ignore
  for this header — a policy that looks present while enforcing nothing.
- `'unsafe-eval'` is added in development only, and never ships: React needs it for
  debugging features such as reconstructing a component stack, and never uses it in production.
  Relaxing that one directive locally keeps the rest of the policy — `connect-src 'self'` above
  all — enforced on the dev server, so the claim can be tested without a build.
- `'wasm-unsafe-eval'` is required for DuckDB and permits WASM compilation only, not JavaScript
  `eval`. `'unsafe-inline'` for scripts is needed because a static export has no server to mint a
  nonce; it costs less here than usual, since nothing in this app renders user input as markup.

[`public/_headers`](public/_headers) carries the same policy for hosts that read it, plus
`frame-ancestors` and the other headers a meta tag cannot express.

### Visitor analytics

The deployment on Vercel counts page views with Vercel Web Analytics
([`components/SiteAnalytics.tsx`](components/SiteAnalytics.tsx)). It needed no change to the
policy above: on Vercel both its script (`/_vercel/insights/script.js`) and its beacon are served
from the site's own domain, so they are `'self'`. It sets no cookies, and sees page paths, never
anything typed into a tool.

- **Production builds only.** In development the package would load a debug script from
  `va.vercel-scripts.com`, which the policy rightly blocks, so nothing is rendered locally.
- **Paths, not full URLs.** A `beforeSend` hook drops the query string and fragment from every
  event. No tool puts data in a URL today; this keeps a future one from leaking a column name
  into a visitor report.
- **Other hosts.** Deployed anywhere but Vercel, the script path returns 404 and nothing is
  counted — the tools are unaffected.

Analytics must be enabled for the project in the Vercel dashboard (Analytics tab) before events
are recorded.

### Comparing Elasticsearch index mappings

`/schema-diff` takes index mappings as well as SQL, deciding per side from what was pasted rather
than from a mode switch. The job is checking that an index was created the way it was asked for,
and the two documents involved are never textually equal even when the answer is yes:

    what you send   { "mappings": { "properties": { … } }, "settings": { … } }
    what you get    { "my_index": { "aliases": {}, "mappings": { … }, "settings": { … } } }

Everything the cluster does to a request on the way in is undone before comparing, because each
would otherwise be reported as a difference in an index that is exactly what was asked for:

- The response wraps everything in the index name, so that is unwrapped and the name kept.
- Key order inside a field definition is not preserved, so attributes are compared by value
  through a key-sorted encoding.
- Settings are filed under `index.`, so a request's `number_of_shards` is compared with the
  answer's `index.number_of_shards` — and `5` with `"5"`, since values come back as strings.
- A parameter set to its default (`"index": true`, a date's default `format`) is left out of the
  answer, so absent and default compare equal.
- A dotted field name, `"geo.country"`, comes back as an object `geo` holding `country`.
- The cluster writes settings of its own — `uuid`, `creation_date`, `provided_name`,
  `version.created`, and `_tier_preference` since 7.10. They sit in the same list but are
  labelled as the cluster's and never counted.

The mapping's own parameters — `dynamic`, `_source`, `dynamic_templates` and the rest — are compared
alongside the settings, since `dynamic` quietly loosening from `strict` to `true` is one of the
changes worth catching. A copy out of Kibana's Dev Tools, with its `PUT my_index` line and `//`
comments, is read as it is, as are Elasticsearch 6 mappings with a type name and index
templates.

Both boxes are editors with line gutters, and every difference is tinted on the line it occurs —
green for added, red for removed, amber for a changed type or setting. The table names the line
too, as `line 6` when both sides agree or `line 6 → 8` when the same field sits at different
depths in the two documents. `JSON.parse` throws position away, so
[`lib/json-lines.ts`](lib/json-lines.ts) scans the raw text for each key path and its line; SQL
columns already carried a line from the DDL parser.

Highlights are applied by dispatching a CodeMirror effect rather than rebuilding the editor, so
recomputing the diff on every keystroke does not cost you the cursor, the selection or the undo
history.

Fields and settings share one result table rather than having one each. They answer the same
question — did this index come out the way it was asked for — and splitting them made the reader
check two places and decide which mattered. One toggle hides what is not a difference: fields that
match, and the settings the cluster wrote itself.

Beyond added, removed and retyped, a field can come back **reconfigured**: the right type with
different settings. A `keyword` that lost its normalizer is the case worth having — it passes a
type-only comparison and behaves differently at query time. Nested objects flatten to dotted
paths, keeping the parent so an `object` that became a string is still visible, and multi-fields
appear under the name you would query them by.

### Reading CREATE TABLE

[`lib/ddl.ts`](lib/ddl.ts) is a purpose-built reader rather than a grammar. The grammars it
replaced each knew one dialect, so real DDL from anywhere else — `timestamp(6)` in Athena, `ENCODE
az64` in Redshift, `[nvarchar](max)` from SQL Server, `VARCHAR2(20 BYTE)` from Oracle — stopped the
parse part-way and silently dropped every column after it, which the schema diff then reported as
removed. The reader only needs brackets, quotes and commas: the column list is the first bracketed
group after the table name, columns are split at commas outside brackets (so a
`struct<city:string,zip:string>` stays one column), and a column's type runs until the first
option keyword. Backticks, brackets and double quotes are removed from names, so `SHOW CREATE
TABLE` output compares equal to the same table written by hand.

The schema diff compares types as they mean rather than as they are spelled — `decimal(18, 2)`
and `decimal(18,2)`, `int` and `integer` are the same — and reports changes to `NOT NULL`,
`DEFAULT`, collation and partitioning, and columns that moved: an Athena table over CSV or ORC
reads columns by position, so a swap in the DDL silently swaps the data. If any part of a
statement cannot be read, the side says which line, and the result says a removed column may
simply have been skipped.

Mixing the two formats is refused rather than guessed. Comparing `keyword` against `varchar` means
deciding they are equivalent, which is a judgement about the data rather than a fact about the
schemas — the same refusal the dialect converter makes.

### Reviewing and converting without a model

The comparable hosted tools do both of these by sending the query to a language model. That is a
reasonable product and not one this codebase can have, so both are rule-based — and both are
deliberately narrow about it.

[`lib/review.ts`](lib/review.ts) checks nine long-established anti-patterns, each carrying the
reason it costs something and a concrete fix. Each check reads the query's structure — which
SELECT a clause belongs to, what sits inside brackets — rather than searching the flat text, so an
`ORDER BY` inside `OVER (…)` is not a sort, `SELECT *` inside `EXISTS` reads no columns, and a
`WHERE` inside a CTE does not excuse an unfiltered table outside it. A function around a column
only counts when the other side is a constant: two tables' columns compared through the same
`coalesce` is the generator's own check, not a missed index. It cannot rank two queries by speed: without table
statistics, partition layout or indexes, nothing in the browser knows which is faster. The tool
says so on the page rather than implying otherwise.

[`lib/convert.ts`](lib/convert.ts) rewrites identifier quoting, string escaping, `LIMIT`/`TOP`/
`FETCH FIRST`, `CAST` type names, and functions that differ only in spelling. The important part is
the refusal list: a function may only be renamed when both spellings take the same arguments in the
same order. `CHARINDEX` and `STRPOS` look interchangeable and have theirs reversed; `DATEDIFF`
exists in several dialects with different units. Renaming those yields SQL that runs and returns
wrong rows, which is worse than SQL that fails — so they are reported as unconverted, with the
reason, and `convertSql` returns that list alongside the query.

The same list carries the differences that change an answer without any error at all: `7 / 2` is 3
in Trino and 3.5 in MySQL, `||` means OR in MySQL, and `arr[1]` is the first element in Trino but
the second in BigQuery. Row caps are converted where they stand, against the SELECT at their own
nesting level, so a top-5 subquery keeps its limit. In MySQL, Hive, Spark and BigQuery a
double-quoted value is a string, and it is written single-quoted for engines where it would be a
column name.

### Typed variables

Template variables have three kinds:

- **constant** — filled once per run (`{{table_a}}`)
- **bulk** — iterates the pasted list (`{{field}}`)
- **typed** — resolved from each row's data type through a per-dialect map (`{{null_default}}`)

So `coalesce(a.{{field}}, {{null_default}})` produces `'~'` for a `varchar`, `-1` for a `bigint`,
and `TIMESTAMP '1900-01-01 00:00:00'` for a `timestamp`. The map is per dialect because Athena
needs the `TIMESTAMP` prefix and MySQL does not. Defaults live in [`lib/typemap.ts`](lib/typemap.ts)
and can be overridden globally.

A column whose type has no map entry is **left out, and named**, rather than given a default.
Emitting a plausible sentinel for an unknown type would produce a query that runs cleanly and
reports the wrong answer, which is the worst outcome for a correctness tool — but one `array`
column should not stop the other 399 either. Arrays, maps, structs and JSON have no safe stand-in
at all; the message points at the null-safe preset, which checks them correctly.

The presets are built per dialect from the three things that genuinely differ: the null-safe
comparison (`IS DISTINCT FROM`, `<=>`, or spelled out for SQL Server, Oracle and ClickHouse), how
rows are capped (`LIMIT`, `TOP`, `FETCH FIRST`), and whether a query with no table needs `FROM
dual`. Conditional counts use `count(CASE WHEN … THEN 1 END)`, which every engine has; `count_if`
does not exist in PostgreSQL. Variables that hold column or table names are quoted where a name
needs it — `order`, `Customer Name` — and written plainly inside string literals.

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
| `@codemirror/*` | Editor, with SQL keyword and schema completion (~112 KB gz against Monaco's ~937 KB) |
| `write-excel-file` | `.xlsx` export (~19 KB gz) |
| `fflate` | Zip for the numbered `.sql` set |
| `dt-sql-parser` | ANTLR grammars behind query syntax checking (not DDL reading, which is `lib/ddl.ts`) |
| `@duckdb/duckdb-wasm` | The scratchpad engine; lazy-loaded on that route only |

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
- **A data-type fallback for unknown types.** Those columns are left out and named rather than
  given a plausible sentinel.

