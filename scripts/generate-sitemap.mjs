import fs from 'node:fs';

const dialects = [
  'postgresql', 'mysql', 'sqlite', 'transactsql', 'plsql', 'mariadb',
  'snowflake', 'bigquery', 'redshift', 'trino', 'spark', 'hive',
  'clickhouse', 'duckdb', 'db2', 'sql',
];

const baseUrl = 'https://www.sqlparity.com';
const core = [
  '',
  '/scratchpad',
  '/in-list-builder',
  '/bulk-query-generator',
  '/schema-diff',
  '/sql-formatter',
  '/query-optimizer',
  '/sql-converter',
];

const scratchpadIntentPages = [
  '/scratchpad/query-parquet-in-browser',
  '/scratchpad/query-csv-online',
];

let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

// Core pages
for (const path of core) {
  xml += `  <url>\n    <loc>${baseUrl}${path}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${path === '' ? '1.0' : '0.8'}</priority>\n  </url>\n`;
}

// Scratchpad high-intent pages
for (const path of scratchpadIntentPages) {
  xml += `  <url>\n    <loc>${baseUrl}${path}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
}

// 16 Dialect Formatter pages
for (const d of dialects) {
  xml += `  <url>\n    <loc>${baseUrl}/sql-formatter/${d}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
}

// 240 Dialect Converter pair pages
for (const from of dialects) {
  for (const to of dialects) {
    if (from !== to) {
      xml += `  <url>\n    <loc>${baseUrl}/sql-converter/${from}-to-${to}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    }
  }
}

xml += `</urlset>\n`;

fs.writeFileSync('public/sitemap.xml', xml, 'utf8');
const total = core.length + scratchpadIntentPages.length + dialects.length + dialects.length * (dialects.length - 1);
console.log(`Generated sitemap with ${total} URLs.`);
