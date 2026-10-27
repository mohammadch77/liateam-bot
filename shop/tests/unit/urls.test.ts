// The central address helper (src/lib/urls.ts): the new /shop/… addresses, the old → new redirect map (one hop, no
// loops), the bot's old names for the revalidate endpoint, and the canonical / noindex rule of listing pages.
// Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  idFromSlug,
  brandPath,
  categoryPath,
  legacyRoute,
  listingSeo,
  packPath,
  productPath,
  shopAddressOf,
  withQuery,
} from '../../src/lib/urls.ts';
import { isReservedSlug } from '../../src/lib/reserved-slugs.ts';

test('the new addresses: /shop/product, /shop/category, /shop/brand, the pages under /shop', () => {
  assert.equal(productPath(541, 'ریمل', 'serge-rimel-541'), '/shop/product/serge-rimel-541');
  assert.equal(productPath(541, 'ریمل ابرو'), '/shop/product/541-ریمل-ابرو');
  assert.equal(productPath(541, null, 'serge-rimel-999'), '/shop/product/541'); // a slug that does not end with the id
  assert.equal(categoryPath(173, 'مراقبت پوست'), '/shop/category/173-مراقبت-پوست');
  assert.equal(brandPath('trust-pro'), '/shop/brand/trust-pro');
  assert.equal(packPath('skin-routine', 'oily'), '/shop/packs/skin-routine/oily');
  assert.equal(withQuery('/shop', { group: 'care', page: 1, q: '' }), '/shop?group=care&page=1');
  assert.equal(withQuery('/shop', {}), '/shop');
});

test('the code is read from every spelling of a product / category segment', () => {
  for (const s of ['serge-rimel-541', '541-ریمل', encodeURI('541-ریمل'), '541']) assert.equal(idFromSlug(s), 541, s);
  assert.equal(idFromSlug('about'), null);
});

test('old address → new address (the full map)', () => {
  const table: Array<[string, unknown]> = [
    ['/p/serge-rimel-541', { kind: 'product', segment: 'serge-rimel-541' }],
    ['/serge-rimel-541', { kind: 'product', segment: 'serge-rimel-541' }],
    ['/541-ریمل', { kind: 'product', segment: '541-ریمل' }],
    ['/541', { kind: 'product', segment: '541' }],
    ['/c/173-مراقبت-پوست', { kind: 'category', segment: '173-مراقبت-پوست' }],
    ['/brands/trust-pro', { kind: 'path', path: '/shop/brand/trust-pro' }],
    ['/brands', { kind: 'path', path: '/shop/brands' }],
    ['/categories', { kind: 'path', path: '/shop/categories' }],
    ['/offers', { kind: 'path', path: '/shop/offers' }],
    ['/search', { kind: 'path', path: '/shop/search' }],
    ['/packs/skin-routine/oily', { kind: 'path', path: '/shop/packs/skin-routine/oily' }],
    ['/offers/', { kind: 'path', path: '/shop/offers' }],
  ];
  for (const [from, to] of table) assert.deepEqual(legacyRoute(from), to, from);
});

test('addresses that are not old ones are left alone: the new ones, the fixed pages, the root', () => {
  for (const p of [
    '/',
    '/shop',
    '/shop/product/serge-rimel-541',
    '/shop/category/173-x',
    '/shop/brand/trust-pro',
    '/shop/brands',
    '/shop/search',
    '/shop/packs/skin-routine/oily',
    '/about',
    '/contact',
    '/faq',
    '/cart',
    '/admin',
    '/api/search/suggest',
    '/sitemap.xml',
    '/robots.txt',
  ]) {
    assert.equal(legacyRoute(p), null, p);
  }
});

test('no loops and no chains: no new address is an old one, and every target is a new address', () => {
  const news = ['/shop/brands', '/shop/categories', '/shop/offers', '/shop/search', '/shop/brand/x', '/shop/packs/a/b'];
  for (const n of news) assert.equal(legacyRoute(n), null, n);
  for (const old of ['/brands', '/categories', '/offers', '/search', '/brands/x', '/packs/a/b']) {
    const t = legacyRoute(old);
    assert.equal(t?.kind, 'path');
    if (t?.kind === 'path') assert.ok(t.path.startsWith('/shop/'), t.path);
  }
});

test('reserved slugs: the shop\'s own pages and old prefixes are never looked up as a product', () => {
  for (const s of ['about', 'contact', 'help', 'cart', 'faq', 'product', 'category', 'brand', 'shop', 'p', 'c', 'brands', 'categories', 'offers', 'search', 'packs', 'api']) {
    assert.ok(isReservedSlug(s), s);
  }
  assert.equal(legacyRoute('/about'), null);
  assert.equal(legacyRoute('/help'), null);
});

test('the bot\'s old names are translated for revalidation', () => {
  const table: Array<[string, string]> = [
    ['/p/serge-rimel-541', '/shop/product/serge-rimel-541'],
    ['/p/[slug]', '/shop/product/[slug]'],
    ['/[slug]', '/shop/product/[slug]'],
    ['/serge-rimel-541', '/shop/product/serge-rimel-541'],
    ['/c/[slug]', '/shop/category/[slug]'],
    ['/c/173-x', '/shop/category/173-x'],
    ['/brands/[slug]', '/shop/brand/[slug]'],
    ['/packs/[collection]/[variant]', '/shop/packs/[collection]/[variant]'],
    ['/brands', '/shop/brands'],
    ['/shop', '/shop'],
    ['/', '/'],
    ['/shop/product/x-1', '/shop/product/x-1'],
  ];
  for (const [from, to] of table) assert.equal(shopAddressOf(from), to, from);
});

test('listing canonical: ?page=N is its own page; filters and sort are noindex with the base canonical', () => {
  assert.deepEqual(listingSeo('/shop', {}), { canonical: '/shop' });
  assert.deepEqual(listingSeo('/shop', { page: '1' }), { canonical: '/shop' });
  assert.deepEqual(listingSeo('/shop', { page: '3' }), { canonical: '/shop?page=3' });
  assert.deepEqual(listingSeo('/shop', { page: 'x' }), { canonical: '/shop' });
  assert.deepEqual(listingSeo('/shop/category/1-a', { sort: 'newest' }), {
    canonical: '/shop/category/1-a',
    robots: { index: false, follow: true },
  });
  assert.deepEqual(listingSeo('/shop', { page: '2', inStock: '1' }), {
    canonical: '/shop',
    robots: { index: false, follow: true },
  });
  assert.deepEqual(listingSeo('/shop', { sort: '' }), { canonical: '/shop' });
});
