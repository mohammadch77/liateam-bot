// Shows which category names the /categories payload carries (uses the saved session).
//   node explore/probe-categories.mjs
import { request } from 'playwright';
import fs from 'node:fs';
import { parseCategories } from '../src/categories.mjs';
const opts = { baseURL: 'https://liateam.ir', extraHTTPHeaders: { RSC: '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' } };
if (fs.existsSync('.auth/state.json')) opts.storageState = '.auth/state.json';
const ctx = await request.newContext(opts);
const text = await (await ctx.get('/categories?page=1&_rsc')).text();
const cats = parseCategories(text);
console.log(`${cats.size} named categories`);
for (const c of [...cats.values()].sort((a, b) => a.code - b.code)) console.log(c.code, c.parent_code ?? '-', c.name);
const used = new Set([...text.matchAll(/"category_codes":\[([\d,]*)\]/g)].flatMap((m) => m[1].split(',').filter(Boolean).map(Number)));
console.log('codes used by products but unnamed:', [...used].filter((c) => !cats.has(c)).join(', ') || 'none');
await ctx.dispose();
