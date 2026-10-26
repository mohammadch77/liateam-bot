// Banners the shop leaves out (src/lib/hero-slides.ts): the reason of each and the hero.slide_skipped log line.
// Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroSkipReason, logSkippedHeroSlides, type HeroSlideFacts } from '../../src/lib/hero-slides.ts';

const IMG = 'https://s3.liateam.ir/lamia/public/banner/a.png';
const product = (over: Partial<HeroSlideFacts> = {}): HeroSlideFacts => ({
  position: 0,
  image_url: IMG,
  target_type: 'product',
  target_code: 541,
  product_id: 541,
  is_sellable: true,
  price: '979000',
  missing_since: null,
  category_code: null,
  in_source: null,
  ...over,
});
const category = (over: Partial<HeroSlideFacts> = {}): HeroSlideFacts => ({
  position: 1,
  image_url: IMG,
  target_type: 'category',
  target_code: 173,
  product_id: null,
  is_sellable: null,
  price: null,
  missing_since: null,
  category_code: 173,
  in_source: true,
  ...over,
});

test('a sellable product and an in-source category are shown', () => {
  assert.equal(heroSkipReason(product()), null);
  assert.equal(heroSkipReason(category()), null);
});

test('every filter has its own reason', () => {
  assert.equal(heroSkipReason(product({ product_id: null })), 'product-not-found');
  assert.equal(heroSkipReason(product({ is_sellable: false })), 'product-not-sellable');
  assert.equal(heroSkipReason(product({ price: 0 })), 'product-zero-price');
  assert.equal(heroSkipReason(product({ price: '0' })), 'product-zero-price');
  assert.equal(heroSkipReason(product({ missing_since: new Date('2026-10-20') })), 'product-missing');
  assert.equal(heroSkipReason(category({ category_code: null })), 'category-not-found');
  assert.equal(heroSkipReason(category({ in_source: false })), 'category-not-in-source');
  assert.equal(heroSkipReason(product({ image_url: 'https://evil.example/a.png' })), 'bad-image');
});

test('out of stock is not a reason (the slide is shown)', () => {
  assert.equal(heroSkipReason(product({ is_sellable: true, price: 1 })), null);
});

test('one hero.slide_skipped line per dropped slide: position, target and reason only — no url, no price', () => {
  const lines: Array<[string, Record<string, unknown>]> = [];
  const n = logSkippedHeroSlides(
    [
      product({ position: 0 }),
      product({ position: 1, target_code: 99, product_id: 99, is_sellable: false }),
      category({ position: 2, target_code: 7, category_code: 7, in_source: false }),
      product({ position: 3, price: 0 }),
    ],
    (msg, fields) => lines.push([msg, fields]),
  );
  assert.equal(n, 3);
  assert.deepEqual(lines, [
    [
      'hero.slide_skipped',
      { position: 1, target_type: 'product', target_code: 99, reason: 'product-not-sellable' },
    ],
    [
      'hero.slide_skipped',
      { position: 2, target_type: 'category', target_code: 7, reason: 'category-not-in-source' },
    ],
    [
      'hero.slide_skipped',
      { position: 3, target_type: 'product', target_code: 541, reason: 'product-zero-price' },
    ],
  ]);
  assert.ok(!JSON.stringify(lines).includes('s3.liateam.ir'));
});

test('nothing dropped, nothing logged', () => {
  const lines: unknown[] = [];
  assert.equal(
    logSkippedHeroSlides([product(), category()], (...a) => lines.push(a)),
    0,
  );
  assert.equal(lines.length, 0);
});
