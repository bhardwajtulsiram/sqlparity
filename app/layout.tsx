import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import './globals.css';
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

export const metadata: Metadata = {
  title: {
    default: 'SQLParity — SQL tools that never see your data',
    template: '%s — SQLParity',
  },
  description:
    'Generate hundreds of validation queries from a CREATE TABLE, diff two schemas, build escaped IN lists, format SQL for 16 dialects, review a query for expensive patterns and convert between database engines. Everything is computed in your browser — no account, no upload.',
  applicationName: 'SQLParity',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <SiteHeader />
        <StorageBanner />
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-10 text-xs text-ink-500 sm:px-6 dark:text-ink-400">
          <p>
            SQLParity runs entirely in your browser. No account, no server, no upload — the values
            you paste never leave this machine.
          </p>
        </footer>
      </body>
    </html>
  );
}
