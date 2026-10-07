import type { Metadata } from 'next';

const SITE = 'https://www.sqlparity.com';
const IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: 'SQLParity — SQL tools that never see your data' };

/**
 * A tool page's metadata: its title and description in search results, and the same
 * on the card a shared link unfolds into.
 *
 * Next.js does not merge `openGraph` or `twitter` with the layout's — a page that sets
 * neither shares the home page's card, and a page that sets one without images loses
 * the picture — so every field is written out here, once, for each page.
 */
export function toolMetadata({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  const full = `${title} — SQLParity`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: full,
      description,
      url: `${SITE}${path}`,
      siteName: 'SQLParity',
      locale: 'en_US',
      type: 'website',
      images: [IMAGE],
    },
    twitter: { card: 'summary_large_image', title: full, description, images: [IMAGE.url] },
  };
}
