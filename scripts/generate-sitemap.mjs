const fs = require("node:fs/promises");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SITE_URL = (process.env.SITE_URL || "https://taleforge.pages.dev").replace(/\/$/, "");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase environment variables");

async function query(path) {
  const res = await fetch(SUPABASE_URL + path, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY }
  });
  if (!res.ok) throw new Error(`Supabase request failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const series = await query("/rest/v1/series?select=id,slug,status,published_at&status=in.(ongoing,completed)&order=published_at.desc");
const chapters = await query("/rest/v1/chapters?select=id,series_id,published_at,status&status=eq.published&order=published_at.desc");

const urls = new Map([
  [SITE_URL + "/", { priority: "1.0", changefreq: "daily" }],
  [SITE_URL + "/stories.html", { priority: "0.9", changefreq: "daily" }],
  [SITE_URL + "/notifications.html", { priority: "0.7", changefreq: "daily" }],
  [SITE_URL + "/library.html", { priority: "0.5", changefreq: "weekly" }],
  [SITE_URL + "/privacy.html", { priority: "0.2", changefreq: "monthly" }],
  [SITE_URL + "/terms.html", { priority: "0.2", changefreq: "monthly" }]
]);

for (const s of series) {
  const seriesUrl = s.slug
    ? `${SITE_URL}/series.html?slug=${encodeURIComponent(s.slug)}`
    : `${SITE_URL}/series.html?id=${encodeURIComponent(s.id)}`;
  urls.set(seriesUrl, {
    lastmod: s.published_at, priority: "0.8", changefreq: "daily"
  });
}
for (const c of chapters) {
  urls.set(`${SITE_URL}/chapter.html?id=${encodeURIComponent(c.id)}`, {
    lastmod: c.published_at, priority: "0.6", changefreq: "weekly"
  });
}

const esc = v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const blocks = [...urls.entries()].map(([loc, meta]) => [
  "  <url>",
  `    <loc>${esc(loc)}</loc>`,
  meta.lastmod ? `    <lastmod>${esc(new Date(meta.lastmod).toISOString())}</lastmod>` : "",
  `    <changefreq>${meta.changefreq}</changefreq>`,
  `    <priority>${meta.priority}</priority>`,
  "  </url>"
].filter(Boolean).join("\n"));

await fs.writeFile("sitemap.xml", [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...blocks,
  "</urlset>",
  ""
].join("\n"));
console.log(`Generated ${urls.size} sitemap URLs: ${series.length} series, ${chapters.length} published chapters.`);
