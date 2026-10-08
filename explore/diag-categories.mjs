// Where do category names live? Prints keys mentioning "categor" and short snippets around one
// category code on a few pages (uses the saved session). Read-only; writes nothing.
//   node explore/diag-categories.mjs [code]
import { request } from 'playwright';
const code = process.argv[2] || '151';
const ctx = await request.newContext({ baseURL: 'https://liateam.ir', storageState: '.auth/state.json',
  extraHTTPHeaders: { RSC: '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
for (const path of ['/categories?page=1&_rsc', '/?_rsc', `/categories/${code}?_rsc`, `/categories?category=${code}&_rsc`]) {
  const res = await ctx.get(path, { maxRedirects: 0 });
  const t = await res.text();
  console.log(`\n##### ${path} -> HTTP ${res.status()} len=${t.length} ${res.headers().location ?? ''}`);
  const keys = [...new Set([...t.matchAll(/"([a-zA-Z_]*categor[a-zA-Z_]*)":/gi)].map((m) => m[1]))];
  console.log('keys with "categor":', keys.join(', ') || 'none');
  let n = 0;
  for (const m of t.matchAll(new RegExp(`[:"\\[,]${code}[,"\\]}]`, 'g'))) {
    if (n++ >= 4) break;
    console.log('---', t.slice(Math.max(0, m.index - 160), m.index + 160).replace(/\s+/g, ' '));
  }
  await new Promise((r) => setTimeout(r, 1500));
}
await ctx.dispose();
