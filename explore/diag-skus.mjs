// Do products have variants (colors / sizes) with their own price or stock?
// Compares the catalog listing with each product's own page for a few products. Read-only.
//   node explore/diag-skus.mjs [code ...]     (default: the first 3 products of the listing)
import { request } from 'playwright';
import { extractAll } from '../src/rsc.mjs';
import { parseCategoriesPage } from '../src/rsc.mjs';

const ctx = await request.newContext({ baseURL: 'https://liateam.ir', storageState: '.auth/state.json',
  extraHTTPHeaders: { RSC: '1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

const listing = parseCategoriesPage(await (await ctx.get('/categories?page=1&_rsc')).text(), 1).products;
const codes = process.argv.slice(2).map(Number).filter(Boolean);
const targets = codes.length ? codes : listing.slice(0, 3).map((p) => p.code);
console.log('has_sku on page 1:', listing.filter((p) => p.pricing?.has_sku).length, 'of', listing.length);

for (const code of targets) {
  await sleep(2500);
  const fromList = listing.find((p) => p.code === code);
  console.log(`\n##### product ${code} ${fromList?.title ?? ''}`);
  if (fromList) console.log('listing  :', JSON.stringify({ ...pick(fromList.pricing, ['price', 'payable_price', 'has_sku']), stock: fromList.inventory?.total_inventory }));
  const res = await ctx.get(`/products/${code}?_rsc`, { maxRedirects: 0 });
  const t = await res.text();
  console.log('page     : HTTP', res.status(), 'len', t.length);
  const keys = [...new Set([...t.matchAll(/"([a-zA-Z_]*(?:sku|variant|color|option)[a-zA-Z_]*)":/gi)].map((m) => m[1]))];
  console.log('keys     :', keys.join(', ') || 'none');
  // Sibling models of this product: are they all products we already sync?
  const variants = extractAll(t, 'variant_products').filter(Array.isArray).sort((a, b) => b.length - a.length)[0] ?? [];
  console.log(`variant_products: ${variants.length}`);
  for (const v of variants.slice(0, 8)) {
    const code = v?.code ?? v?.product_code;
    console.log('   ', code, String(v?.title ?? v?.name ?? '').slice(0, 40), '| fields:', Object.keys(v ?? {}).slice(0, 12).join(','));
  }
  if (variants.length) console.log('    all variant codes:', variants.map((v) => v?.code ?? v?.product_code).join(', '));
  // Same product's price/stock as shown on its own page (cross-check of the listing).
  const self = extractAll(t, 'pricing').find((p) => p && (p.code === code || p.product_code === code));
  if (self) console.log('page     :', JSON.stringify(pick(self, ['price', 'payable_price'])));
  for (const key of ['skus', 'product_skus', 'variants', 'items', 'options']) {
    const lists = extractAll(t, key).filter((v) => Array.isArray(v) && v.length && typeof v[0] === 'object');
    if (!lists.length) continue;
    const list = lists.sort((a, b) => b.length - a.length)[0];
    console.log(`"${key}": ${list.length} item(s); fields: ${Object.keys(list[0]).slice(0, 25).join(', ')}`);
    for (const v of list.slice(0, 4)) {
      console.log('   ', JSON.stringify({
        ...pick(v, ['code', 'sku_code', 'title', 'name', 'color', 'color_name', 'size']),
        ...pick(v.pricing ?? v, ['price', 'payable_price']),
        stock: v.inventory?.total_inventory ?? v.total_inventory ?? v.stock ?? v.inventory?.count,
      }));
    }
  }
}
await ctx.dispose();
