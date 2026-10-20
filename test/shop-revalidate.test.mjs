import test from 'node:test';
import assert from 'node:assert/strict';
import { pathsFor, revalidateShop } from '../src/shop-revalidate.mjs';

const slugs = new Map([[541, 'serge-riml-abro-541'], [7, null]]);

test('paths: the product page; lists too for price/stock/catalog changes; home for banners', () => {
  assert.deepEqual(pathsFor([{ event_type: 'reviews_changed', product_code: 541 }], slugs), [{ path: '/p/serge-riml-abro-541' }]);
  const price = pathsFor([{ event_type: 'price_changed', product_code: 541 }], slugs).map((p) => p.path);
  assert.deepEqual(price, ['/p/serge-riml-abro-541', '/', '/shop', '/search', '/c/[slug]', '/brands/[slug]']);
  assert.deepEqual(pathsFor([{ event_type: 'banner_changed', product_code: null }], slugs), [{ path: '/' }]);
  // no English slug yet → every product page (pattern), never a guessed address
  assert.deepEqual(pathsFor([{ event_type: 'faq_changed', product_code: 7 }], slugs), [{ path: '/p/[slug]', type: 'page' }]);
  // duplicates collapse
  assert.equal(pathsFor([{ event_type: 'price_changed', product_code: 541 }, { event_type: 'stock_changed', product_code: 541 }], slugs).length, 6);
});

const env = { SHOP_REVALIDATE_URL: 'http://127.0.0.1:3850/api/internal/revalidate', SHOP_REVALIDATE_SECRET: 'x'.repeat(64) };
const noWait = async () => {};

test('off without URL/secret; sends the secret header; retries a failing shop, then gives up quietly', async () => {
  assert.deepEqual(await revalidateShop([{ path: '/' }], { env: {} }), { ok: false, skipped: true, attempts: 0 });
  const calls = [];
  const ok = await revalidateShop([{ path: '/' }], { env, wait: noWait, fetchImpl: async (url, o) => { calls.push(o); return { ok: true, status: 200 }; } });
  assert.deepEqual(ok, { ok: true, attempts: 1 });
  assert.equal(calls[0].headers['x-revalidate-secret'], env.SHOP_REVALIDATE_SECRET);
  let n = 0;
  const warnings = [];
  const flaky = await revalidateShop([{ path: '/' }], { env, wait: noWait, log: { warn: (m) => warnings.push(m) },
    fetchImpl: async () => { n++; if (n < 3) throw new Error('ECONNREFUSED'); return { ok: true, status: 200 }; } });
  assert.deepEqual(flaky, { ok: true, attempts: 3 });
  const down = await revalidateShop([{ path: '/' }], { env, wait: noWait, log: { warn: (m) => warnings.push(m) },
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false);
  assert.equal(down.attempts, 3);
  assert.equal(warnings.length, 1); // logged, never thrown
  // a refused secret is not retried
  const refused = await revalidateShop([{ path: '/' }], { env, wait: noWait, log: { warn() {} }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.deepEqual([refused.ok, refused.attempts, refused.error], [false, 1, 'HTTP 401']);
});
