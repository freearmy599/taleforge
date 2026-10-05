import fs from "node:fs/promises";

const base = (process.env.SITE_URL || "https://taleforge.pages.dev").replace(/\/$/, "");
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required.");
}

async function query(path) {
  const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
    headers: { apikey: anonKey, Authorization: "Bearer " + anonKey }
  });
  if (!res.ok) throw new Error("Supabase request failed: " + res.status);
  return res.json();
}

const esc = value => String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const urls = [
  ["/","weekly"],
  ["/stories.html","daily"],
  ["/library.html","weekly"],
  ["/notifications.html","daily"],
  ["/privacy.html","monthly"],
  ["/terms.html","monthly"]
];

const series = await query("series?select=id,slug,published_at,status&status=in.(ongoing,completed)&order=published_at.desc");
for (const s of series) {
  const id = encodeURIComponent(s.id);
  urls.push(["/series.html?id=" + id, "weekly", s.published_at]);
}

const chapters = await query("chapters?select=id,published_at,series_id,status&status=eq.published&order=published_at.desc");
for (const c of chapters) {
  urls.push(["/chapter.html?id=" + encodeURIComponent(c.id), "weekly", c.published_at]);
}

const seen = new Set();
const body = urls.filter(([path]) => {
  if (seen.has(path)) return false;
  seen.add(path); return true;
}).map(([path, freq, lastmod]) => `  <url><loc>${esc(base + path)}</loc><changefreq>${freq}</changefreq>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""}</url>`).join("\n");

await fs.writeFile("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
console.log(`Generated sitemap with ${seen.size} public URLs.`);
