# Security Policy

At **SQL Parity**, security and privacy are central to our design. Our core promise is that **your data and queries never leave your machine**.

---

## Architecture & Threat Model

* **Browser-Only Execution:** Every tool runs client-side inside the user's browser using WebAssembly (DuckDB-WASM) and client-side JavaScript/TypeScript.
* **No Remote SQL Execution:** SQL queries, schemas, identifiers, spreadsheet values, and uploaded CSV/Parquet files are never uploaded, sent over a network, or stored on an external server.
* **Strict Content Security Policy (CSP):** The application serves strict CSP headers (`connect-src 'self'`) and sandbox directives designed to block outbound network requests to third-party endpoints.
* **Privacy-Guarded Analytics:** Vercel Web Analytics runs in production builds only. A `beforeSend` hook strips all query parameters and hash fragments so column names or parameters can never leak into analytics logs.

---

## Supported Versions

Only the latest version deployed on `main` (and live at [www.sqlparity.com](https://www.sqlparity.com)) is actively maintained and supported with security updates.

| Version | Supported |
| :--- | :--- |
| `main` (latest deployment) | :white_check_mark: |
| Older commits / custom forks | :x: |

---

## Reporting a Vulnerability

If you discover a security vulnerability—especially anything related to:
* Cross-Site Scripting (XSS) in query or error rendering,
* Content Security Policy (CSP) bypasses,
* Data leakage, unhandled external network calls, or telemetry flaws,
* WebAssembly / DuckDB memory or sandbox vulnerabilities,

**Please do NOT disclose it in a public GitHub issue.**

### How to Report Privately:
1. **Email:** Send a detailed report to **`bhardwajtulsiram@gmail.com`**.
2. **Subject:** `[SECURITY] SQL Parity Vulnerability Report`
3. **Include:**
   * A clear description of the vulnerability.
   * Steps to reproduce or proof-of-concept (PoC) code.
   * The potential impact on users.
   * Browser version and environment details.

### Response Timelines:
* **Acknowledgment:** We will acknowledge receipt of your report within **48 hours**.
* **Assessment:** We will confirm the vulnerability and provide a status update within **5 business days**.
* **Remediation & Disclosure:** Once a fix is verified, it will be pushed to `main` and deployed immediately. We will coordinate with you on public credit and disclosure timing.

---

Thank you for helping keep SQL Parity safe and private for the community!
