// One product page (/products/{code}?_rsc): saves the payload and lists candidate description / brand fields.
// Read-only, a single request with the saved session. Usage: node explore/probe-product-page.mjs 541
import fs from 'node:fs';
import { request } from 'playwright';
import { config } from '../src/config.mjs';

const code = Number(process.argv[2] ?? 541);
const ctx = await request.newContext({
  baseURL: config.baseUrl,
  storageState: config.storageStatePath,
  extraHTTPHeaders: {
    RSC: '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    'Accept-Language': 'fa-IR,fa;q=0.9',
  },
  maxRedirects: 0,
});
const res = await ctx.get(`/products/${code}?_rsc`);
const text = await res.text();
await ctx.dispose();
fs.mkdirSync('explore/output', { recursive: true });
fs.writeFileSync(`explore/output/product-${code}.rsc.txt`, text);
console.log('HTTP', res.status(), text.length, 'chars');
// every "key": with a long string value, and anything brand-ish
const keys = new Map();
for (const m of text.matchAll(/"([a-z_]{3,40})":("(?:[^"\\]|\\.){0,40})/g)) {
  if (!keys.has(m[1])) keys.set(m[1], m[2]);
}
for (const [k, v] of keys) if (/desc|brand|body|content|text|summary|intro|detail|feature|spec|attribute/i.test(k)) console.log(k.padEnd(28), v);
