import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPage, type DocSection } from '@/components/DocPage';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description:
    'The terms for using the SQLParity website: free browser-based SQL tools, provided as is, with your data staying on your device.',
  alternates: { canonical: '/terms/' },
};

const UPDATED = '2026-10-07';
const EMAIL = 'contact@sqlparity.com';
const REPO = 'https://github.com/bhardwajtulsiram/sqlparity';

const SECTIONS: DocSection[] = [
  {
    id: 'agreement',
    title: 'About these terms',
    body: (
      <>
        <p>
          These terms apply to your use of the SQLParity website at <strong>www.sqlparity.com</strong> (&ldquo;the
          site&rdquo;), run by Tulsiram Bhardwaj (&ldquo;we&rdquo;). By using the site you agree to them. If you do not
          agree, please do not use it.
        </p>
        <p>
          How we handle information is described separately in the <Link href="/privacy/">privacy policy</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'the-service',
    title: 'What the site provides',
    body: (
      <>
        <p>
          The site provides free tools for working with SQL and data — among them Parity Run, the SQL Converter, the
          SQL Formatter and the SQL Scratchpad. They run entirely in your web browser. There is no account to create and nothing
          to install.
        </p>
        <p>
          We may add, change or remove tools and features, and may suspend the site for maintenance, without notice.
        </p>
      </>
    ),
  },
  {
    id: 'open-source',
    title: 'Open-source code and trademarks',
    body: (
      <>
        <p>
          The source code behind the site is open source under the{' '}
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            GNU Affero General Public License v3
          </a>
          . That licence, not these terms, governs what you may do with the code — including running your own copy.
        </p>
        <p>
          The licence does not cover the SQLParity name, logo or visual identity. Their use is governed by the{' '}
          <a href={`${REPO}/blob/main/TRADEMARK.md`} target="_blank" rel="noopener noreferrer">
            trademark policy
          </a>
          : in short, a public copy of the code must use its own name and logo.
        </p>
        <p>
          The site also includes third-party software, such as DuckDB, PGlite (PostgreSQL) and SQLite, which remains
          under its own licence.
        </p>
      </>
    ),
  },
  {
    id: 'your-data',
    title: 'Your data and your responsibility',
    body: (
      <>
        <p>
          The data you use with the tools stays on your device and remains yours. We never receive it, so we cannot
          recover it, and it is lost when you close the tab unless you save it yourself.
        </p>
        <p>
          You are responsible for having the right to use any data you work with, and for following your
          organisation&apos;s policies when you do.
        </p>
      </>
    ),
  },
  {
    id: 'results',
    title: 'Checking the results',
    body: (
      <>
        <p>
          The tools are designed to be accurate and to say plainly what they could not check, but they can still be
          wrong or incomplete. Generated SQL, conversions, reviews and comparisons should be checked before you rely on
          them, especially before running SQL against a production database.
        </p>
        <p>
          A Parity Run sign-off report records what the tool found in the files you gave it, with the settings you chose.
          It is not a certification or audit by SQLParity, and you should not present it as one. Decisions you make based
          on any output from the site are your own.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <p>When using the site, you agree not to:</p>
        <ul>
          <li>attempt to disrupt, overload or gain unauthorised access to the site or the systems that host it;</li>
          <li>use automated means to make excessive requests to the site;</li>
          <li>use the site for anything unlawful, or to process data you have no right to use;</li>
          <li>present the site, its output or a copy of it as being run, endorsed or certified by us when it is not.</li>
        </ul>
        <p>
          Security research done in good faith is welcome — please follow the{' '}
          <a href="https://github.com/bhardwajtulsiram/sqlparity/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">
            security policy
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'no-warranty',
    title: 'No warranty',
    body: (
      <p>
        The site and its tools are provided free of charge, &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
        warranties of any kind, express or implied — including warranties of accuracy, fitness for a particular purpose
        and uninterrupted availability — to the fullest extent the law allows.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <p>
        To the fullest extent the law allows, we are not liable for any indirect, incidental or consequential loss, or for
        loss of data, revenue or profits, arising from your use of the site or reliance on its output. Nothing in these
        terms limits liability that cannot be limited by law.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. When we do, we will change the date at the top of this page; the history of every
        change is public in the{' '}
        <a href={REPO} target="_blank" rel="noopener noreferrer">
          project&apos;s repository
        </a>
        . Continuing to use the site after a change means you accept the updated terms.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <DocPage
      kicker="Trust"
      title="Terms of use"
      intro={<p>The rules for using the SQLParity website, written to be read rather than skimmed past.</p>}
      updated={UPDATED}
      summary={[
        'The tools are free to use, with no account.',
        'Your data stays on your device and remains yours.',
        'Check results before you rely on them — the tools are provided as is, without warranty.',
        'The code is open source under AGPLv3; the SQLParity name and logo are covered by the trademark policy.',
      ]}
      sections={SECTIONS}
      related={[
        { href: '/privacy/', label: 'Privacy policy' },
      ]}
    />
  );
}
