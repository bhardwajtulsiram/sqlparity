import type { Metadata } from 'next';
import { DocPage, type DocSection } from '@/components/DocPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What SQLParity collects and what it never sees. Everything you paste or drop is processed in your browser tab and is never uploaded; page views are counted without cookies.',
  alternates: { canonical: '/privacy/' },
};

const UPDATED = '2026-10-07';
const EMAIL = 'contact@sqlparity.com';

const SECTIONS: DocSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          SQLParity is a set of browser-based SQL tools at <strong>www.sqlparity.com</strong>, run by Tulsiram Bhardwaj
          (&ldquo;we&rdquo;). This policy covers that website. If you run your own copy of the open-source code, you are
          responsible for how your copy handles data.
        </p>
        <p>
          Questions about this policy: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-never-see',
    title: 'What we never see',
    body: (
      <>
        <p>
          Everything you put into a tool stays on your device. That includes SQL queries, table definitions, column
          names, lists of values, schema files, and the CSV, Parquet or JSON files you drop into the Scratchpad or Parity
          Run. They are read and processed by code running inside your browser tab — including the SQL engines, which run
          there as WebAssembly — and are never sent to us or to anyone else.
        </p>
        <p>
          This is enforced by your browser, not only promised: the site sends a Content Security Policy that forbids the
          page from connecting to any other server. You can check it yourself in your browser&apos;s developer tools: the
          Network tab shows every request the page makes, and all of them go to this site. Results you produce — formatted SQL, generated queries, parity results and sign-off reports — are
          created in the tab too, and only leave it if you copy or download them.
        </p>
      </>
    ),
  },
  {
    id: 'in-your-browser',
    title: 'What is stored in your browser',
    body: (
      <>
        <p>We do not use cookies. Two kinds of browser storage are used, and both stay on your device:</p>
        <ul>
          <li>
            <strong>Local storage</strong> keeps your tool settings between visits — for example your chosen SQL dialect,
            formatter options and the bulk generator&apos;s template. Keys start with <code>sqlparity:</code>.
          </li>
          <li>
            <strong>Session storage</strong> carries a column list from Schema Diff to the Bulk Query Generator when you
            ask it to. It is read once and deleted straight away, and disappears when the tab closes.
          </li>
        </ul>
        <p>
          You can clear both at any time in your browser&apos;s site settings. Nothing in them is sent to us.
        </p>
      </>
    ),
  },
  {
    id: 'share-links',
    title: 'Share links',
    body: (
      <>
        <p>
          Some tools can create a share link. The content you share is compressed into the part of the address after the
          <code>#</code>. Browsers never send that part to a web server, so it does not reach us when the link is opened,
          and our analytics removes it before anything is counted.
        </p>
        <p>
          Anyone who has the link can read what is in it, though. Treat a share link like the data it contains, and only
          send it to people who should see that data.
        </p>
      </>
    ),
  },
  {
    id: 'analytics',
    title: 'Visitor analytics',
    body: (
      <>
        <p>
          We count page views with <strong>Vercel Web Analytics</strong> to understand which tools are used. It runs
          only on the live site, uses no cookies, and is served from our own domain. For each page view it records
          aggregate information such as:
        </p>
        <ul>
          <li>the page path, with any query string and <code>#</code> fragment removed before it is sent;</li>
          <li>the referring website, if your browser provides one;</li>
          <li>browser, operating system and device type;</li>
          <li>an approximate country, derived by Vercel from the request.</li>
        </ul>
        <p>
          It never includes anything you type, paste or drop into a tool. We use these figures only in aggregate, and we
          do not use them to identify you. How Vercel processes this data is described in{' '}
          <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
            Vercel&apos;s privacy policy
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: 'hosting',
    title: 'Hosting and server logs',
    body: (
      <>
        <p>
          The website is hosted by Vercel. Like any web host, Vercel receives standard request information when your
          browser asks for a page or file — such as your IP address, the address requested and your browser&apos;s user
          agent — in order to deliver the site and protect it from abuse. These requests are for the website&apos;s own
          files (pages, scripts and the database engines); they do not contain your data.
        </p>
      </>
    ),
  },
  {
    id: 'email',
    title: 'If you contact us',
    body: (
      <p>
        If you email us, we receive your email address and whatever you write, and use them only to reply and to keep a
        record of the conversation. Ask us at any time and we will delete that correspondence.
      </p>
    ),
  },
  {
    id: 'third-parties',
    title: 'Sharing, selling and other sites',
    body: (
      <>
        <p>
          We do not sell, rent or share personal information, and the site carries no advertising. The only service
          provider involved in running the site is Vercel, as host and for analytics.
        </p>
        <p>
          Links to GitHub and other sites take you outside SQLParity; their own privacy policies apply there.
        </p>
      </>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your choices and rights',
    body: (
      <>
        <p>
          Because the tools work without an account and your data never reaches us, there is usually nothing about you
          for us to access, correct or delete. You can still:
        </p>
        <ul>
          <li>clear your settings by clearing this site&apos;s storage in your browser;</li>
          <li>block analytics with a content blocker — every tool keeps working;</li>
          <li>
            ask us about, or ask us to delete, any correspondence we hold, at <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </li>
        </ul>
        <p>
          Depending on where you live, you may have further rights under data-protection law, including the right to
          complain to your local supervisory authority.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>SQLParity is a tool for professionals and is not directed at children.</p>,
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        If we change how the site handles information, we will update this page and the date at the top. The history of
        every change is public in the{' '}
        <a href="https://github.com/bhardwajtulsiram/sqlparity" target="_blank" rel="noopener noreferrer">
          project&apos;s repository
        </a>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <DocPage
      kicker="Trust"
      title="Privacy policy"
      intro={
        <p>
          SQLParity was built so that the data you check never has to leave your machine. This page explains exactly what
          that means, and the little the website does collect.
        </p>
      }
      updated={UPDATED}
      summary={[
        'Nothing you paste, type or drop into a tool is uploaded. It is processed inside your browser tab.',
        'No account, no sign-up and no cookies.',
        'Page views are counted anonymously with Vercel Web Analytics, without your data in them.',
        'Settings are kept in your browser only, and you can clear them at any time.',
      ]}
      sections={SECTIONS}
      related={[
        { href: '/terms/', label: 'Terms of use' },
      ]}
    />
  );
}
