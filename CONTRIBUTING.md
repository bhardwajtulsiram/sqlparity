# Contributing to SQL Parity

Thank you for your interest in contributing to **SQL Parity**! We welcome community contributions, dialect improvements, bug reports, and optimizations.

---

## Core Architecture Principles

Before submitting any code, please ensure your contribution adheres to our core architectural principles:

1. **No Data Uploads & 100% Client-Side:**  
   Everything must run entirely in the user's browser (no cookies, nothing you paste is ever tracked). **No PR will be accepted that introduces a remote backend, external API dependency, or third-party network call.**
2. **Deterministic & Safe Escaping:**  
   A wrong escape produces SQL that executes successfully and returns the wrong rows. All dialect escaping, formatting, and conversion changes must have corresponding unit test coverage in `tests/`.
3. **Trademark Protection:**  
   All code contributions are licensed under the **GNU Affero General Public License v3 (AGPLv3)**. Contributing code does not grant rights to the "SQL Parity" or "SQLParity" trademarks, which remain protected under our [Trademark Policy](TRADEMARK.md).

---

## Local Development Setup

### 1. Prerequisites
* **Node.js:** v20.0.0 or higher
* **pnpm** (preferred) or **npm** / **yarn**

### 2. Install Dependencies
```bash
git clone https://github.com/bhardwajtulsiram/sqlparity.git
cd sqlparity
pnpm install
```

### 3. Copy the In-Browser Database Engines
DuckDB, PostgreSQL (PGlite) and SQLite run in the browser from WebAssembly files served by this site. They are copied into `public/duckdb/` and `public/engines/` automatically before `dev` and `build`, or you can run it manually:
```bash
node scripts/copy-engines.mjs
```

### 4. Start the Dev Server
```bash
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Verification & Testing

Every PR must pass all unit tests and TypeScript checks.

```bash
# Run unit test suite (Vitest)
pnpm test
# or: npx vitest run

# Type check
pnpm typecheck
# or: npx tsc --noEmit

# Static production build verification
pnpm build
```

---

## Contributing SQL Dialects and Converter Rules

SQL Parity supports 16+ database engines and dialects. Adding dialect rules or fixing syntax differences involves:

* **Dialect Definitions:** [`lib/dialects.ts`](lib/dialects.ts) (specifies quoting styles, backslash escaping, regex patterns, and comment syntax).
* **Escaping & Formatting:** [`lib/escape.ts`](lib/escape.ts) and [`lib/format.ts`](lib/format.ts).
* **Dialect Conversion:** [`lib/convert.ts`](lib/convert.ts) (translates functions, syntax, and row limits across engines).
* **Testing:** Add test cases into [`tests/convert.test.ts`](tests/convert.test.ts) or [`tests/escape.test.ts`](tests/escape.test.ts) showing the exact before-and-after SQL for both valid and invalid queries.

---

## Pull Request Guidelines

1. **Create a topic branch:**
   ```bash
   git checkout -b fix/postgres-regex-conversion
   ```
2. **Make focused, atomic changes:** Keep PRs small and focused on a single issue or dialect improvement.
3. **Add tests:** Ensure every new code branch has unit tests in `tests/`.
4. **Verify tests and build:** Run `pnpm test` and `pnpm typecheck`.
5. **Submit your PR:**
   * Describe the problem and the solution clearly.
   * Provide sample SQL snippets showing input, expected output, and actual output.
   * Fill out the checklist in the PR template.

---

## Reporting Issues

* **Bug Reports:** Open an issue using our [Bug Report Template](https://github.com/bhardwajtulsiram/sqlparity/issues/new?template=bug_report.yml). Include the specific SQL dialect, browser version, sample input query, and expected behavior.
* **Dialect Requests:** Propose a new SQL engine or grammar construct using our [Dialect Request Template](https://github.com/bhardwajtulsiram/sqlparity/issues/new?template=dialect_request.yml).
* **Security Flaws:** Do **not** open a public issue. Please follow [SECURITY.md](SECURITY.md) to report security concerns privately.

---

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md).
