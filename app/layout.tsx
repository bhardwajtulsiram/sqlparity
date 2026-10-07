import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
import { contentSecurityPolicy } from '@/lib/csp';
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
 * The Content Security Policy, as a <meta> tag so it applies on any host — a static
 * export has no server to send headers. It must be http-equiv: Next's
 * `metadata.other` emits name=, which browsers ignore for this. The policy itself,
 * and why each directive is there, lives in lib/csp.ts; vercel.json sends the same
 * policy as a header, plus frame-ancestors, which a meta tag cannot carry.
 */
const CONTENT_SECURITY_POLICY = contentSecurityPolicy({ dev: process.env.NODE_ENV !== 'production' });

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
    'query CSV in browser',
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
      'Browser-only SQL tools for data-migration verification: bulk query generation, schema diffing, formatting, an in-browser SQL scratchpad, and dialect conversion. 100% computed in-browser.',
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
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

const JSON_LD_DATA = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'SQLParity',
  url: 'https://www.sqlparity.com',
  description:
    'Client-side, privacy-first SQL utilities for schema diffing, bulk validation queries, in-tab file querying, and dialect conversion.',
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
        <link rel="alternate" type="text/markdown" href="/llms.txt" title="LLM Context" />
        <meta name="theme-color" content="#11131c" />
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
