import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Static export: the whole app is prerendered to plain files in out/ and can be
  // hosted anywhere. There is no server, which is what keeps the promise that
  // nothing a user pastes ever leaves their browser.
  output: 'export',
  images: { unoptimized: true },
  // Directory-style URLs so out/ works on any static host without rewrite rules.
  trailingSlash: true,
};

export default nextConfig;
