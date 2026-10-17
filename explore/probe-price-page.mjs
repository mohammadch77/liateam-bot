// Price diagnosis: fetches product pages as a logged-in browser sees them (HTML, not RSC) and saves them, so the
// price Liateam DISPLAYS can be compared with the raw price fields in the same page's data.
// Read-only, a pause of 6–18 s before each page. Usage: node explore/probe-price-page.mjs 412 547 …
import fs from 'node:fs';
import { request } from 'playwright';
import { config } from '../src/config.mjs';

const codes = process.argv.slice(2).map(Number);
const ctx = await request.newContext({
  baseURL: config.baseUrl,
  storageState: config.storageStatePath,
  extraHTTPHeaders: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'fa-IR,fa;q=0.9',
  },
});
fs.mkdirSync('explore/output/price', { recursive: true });
for (const [i, code] of codes.entries()) {
  if (i) await new Promise((r) => setTimeout(r, 6000 + Math.random() * 12000));
  const res = await ctx.get(`/products/${code}`);
  const html = await res.text();
  fs.writeFileSync(`explore/output/price/${code}.html`, html);
  console.log(code, 'HTTP', res.status(), html.length, 'chars');
}
await ctx.dispose();
