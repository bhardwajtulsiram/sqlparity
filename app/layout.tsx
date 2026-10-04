import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { SiteAnalytics } from '@/components/SiteAnalytics';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { StorageBanner } from '@/components/StorageBanner';

/**
 * IBM Plex, not the usual geometric sans.
 *
 * Plex was drawn for an engineering company and reads that way — a little technical,
 * a little industrial, without being cold. The mono is the point as much as the sans:
 * this product's material is identifiers and SQL, so the monospace face is doing real
 * work on nearly every screen rather than decorating small labels.
 *
 * next/font self-hosts these at build time, so the page makes no external request at
 * runtime. That matters more here than usual: "nothing leaves your browser" should be
 * literally true, including the fonts.
 */
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

/**
 * Content Security Policy, shipped with the page.
 *
 * The product's claim is that nothing you paste leaves the tab. That is true because
 * of how the code is written — but "true because I wrote it carefully" is a weaker
 * guarantee than "the browser will not permit otherwise". `connect-src 'self'` is the
 * directive that matters: it forbids this page from opening a request to any other
 * origin, so a dependency that turned malicious in some future update still could not
 * send a schema anywhere. The claim stops depending on my diligence.
 *
 * Two allowances are deliberate and worth knowing about:
 *
 *   'wasm-unsafe-eval'  DuckDB is WebAssembly, and compiling it needs this. It permits
 *                       WASM compilation only, not JavaScript eval.
 *   'unsafe-inline'     Next inlines its hydration data as a script tag, and a static
 *                       export has no server to mint a nonce per request. This weakens
 *                       the cross-site-scripting protection, which matters less here
 *                       than usual: nothing in this app ever renders user input as
 *                       markup, so there is no injection point to exploit.
 *
 * Set as a meta tag because a static export has no server to send headers, and it must
 * be http-equiv — Next's `metadata.other` emits name=, which browsers ignore for this.
 * public/_headers carries the same policy for hosts that read it, plus the directives
 * a meta tag cannot express.
 */
/**
 * React needs eval() in development for its debugging features — reconstructing a
 * component stack from another environment, mainly — and never in production. Relaxing
 * only this one directive, only in development, keeps the rest of the policy in force
 * locally: connect-src 'self' is the line that enforces the product's claim, and it is
 * worth being able to test that on the dev server rather than only after a build.
 */
const DEV_EVAL = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'${DEV_EVAL}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // The one that enforces the promise.
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export const metadata: Metadata = {
  metadataBase: new URL('https://www.sqlparity.com'),
  title: {
    default: 'SQLParity — SQL tools that never see your data',
    template: '%s — SQLParity',
  },
  description:
    'Generate hundreds of validation queries from a CREATE TABLE, diff two schemas, build escaped IN lists, format SQL for 16 dialects, review a query for expensive patterns and convert between database engines. Everything is computed in your browser — no account, no upload.',
  applicationName: 'SQLParity',
  alternates: {
    canonical: '/',
  },
  keywords: [
    'SQL tools',
    'SQL dialect converter',
    'SQL schema diff',
    'bulk validation queries',
    'DuckDB in browser',
    'query parquet online',
    'SQL IN list builder',
    'SQL formatter 16 dialects',
    'privacy first SQL tool',
    'client side SQL',
    'database migration tools',
  ],
  openGraph: {
    title: 'SQLParity — SQL tools that never see your data',
    description:
      'Browser-only SQL tools for data-migration verification: bulk query generation, schema diffing, formatting, DuckDB scratchpad, and dialect conversion. 100% computed in-browser.',
    url: 'https://www.sqlparity.com',
    siteName: 'SQLParity',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'SQLParity — SQL tools that never see your data',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SQLParity — In-Browser SQL Migration & Analysis Tools',
    description:
      'SQL tools that never see your data. 100% computed in your browser — no cookies, nothing you paste is ever tracked.',
    images: ['/og-image.png'],
  },
};

const JSON_LD_DATA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'SQLParity',
  url: 'https://www.sqlparity.com',
  description:
    'Client-side, privacy-first SQL utilities for schema diffing, bulk validation queries, DuckDB in-tab querying, and dialect conversion.',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'All',
  browserRequirements: 'Requires JavaScript, WASM support',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      {/*
        Rendered here rather than through the metadata export, which emits name= and
        is silently ignored by browsers for this header. A policy that looks present
        but is not enforced is worse than none, because you stop looking.
      */}
      <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD_DATA) }}
        />
      </head>
      <body className="relative flex min-h-screen flex-col antialiased">
        <div aria-hidden="true" className="page-backdrop" />
        <SiteHeader />
        <StorageBanner />
        <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-4 pt-8 pb-4 sm:px-6 sm:pt-10">
          {children}
        </main>
        <SiteFooter />
        <SiteAnalytics />
      </body>
    </html>
  );
}
