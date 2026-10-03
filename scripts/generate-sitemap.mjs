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

let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

for (const path of core) {
  xml += `  <url>\n    <loc>${baseUrl}${path}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${path === '' ? '1.0' : '0.8'}</priority>\n  </url>\n`;
}

for (const from of dialects) {
  for (const to of dialects) {
    if (from !== to) {
      xml += `  <url>\n    <loc>${baseUrl}/sql-converter/${from}-to-${to}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    }
  }
}

xml += `</urlset>\n`;

fs.writeFileSync('public/sitemap.xml', xml, 'utf8');
console.log(`Generated sitemap with ${core.length + dialects.length * (dialects.length - 1)} URLs.`);
