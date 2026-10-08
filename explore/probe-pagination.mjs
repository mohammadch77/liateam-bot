// Probe which query param paginates /categories (RSC). Optional storageState via .auth/state.json.
import { request } from 'playwright';
import fs from 'node:fs';
const opts = { baseURL: 'https://liateam.ir', extraHTTPHeaders: { RSC: '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' } };
if (fs.existsSync('.auth/state.json')) opts.storageState = '.auth/state.json';
const ctx = await request.newContext(opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const q of ['', '?page=2', '?current=2']) {
  const res = await ctx.get('/categories' + q);
  const t = await res.text();
  const codes = [...t.matchAll(/"product_code":(\d+)/g)].map((m) => m[1]);
  const meta = [...t.matchAll(/"(total|current|pageSize|page|per_page)":(\d+)/g)].map((m) => m[0]);
  console.log(`/categories${q} -> ${res.status()} len=${t.length} first=${codes.slice(0,4)} n=${codes.length/2} ${[...new Set(meta)].join(' ')}`);
  await sleep(2000);
}
await ctx.dispose();
