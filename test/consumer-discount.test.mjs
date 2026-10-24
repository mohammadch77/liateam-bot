import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumerDiscountOf, normalize } from '../src/normalize.mjs';

// pricing blocks as Liateam's listing sends them (explore/output, 2026-10): the partner discounts are always there,
// a consumer discount («discount_product») only during Liateam's own sales
const PARTNER = [
  { type: 'base_retail', title: 'base_retail', can_show: false, percent: 0, used_in_calc: true },
  { type: 'extra_retail_percent', title: 'extra_retail_percent', can_show: true, percent: 4, used_in_calc: true },
];
const SALE = { type: 'discount_product', title: 'زمانی کوتاه برای انتخابی خاص', can_show: true, percent: 15, used_in_calc: true };
const raw = (discounts) => ({
  code: 54,
  title: 'محصول',
  pricing: { price: 579000, payable_price: 468990, discount_price: 110010, discounts },
  inventory: { total_inventory: 5, is_available: true },
});

test('no consumer discount: only the partner discounts → 0', () => {
  assert.equal(consumerDiscountOf(raw(PARTNER)), 0);
});

test('Liateam sale: the shown consumer discount, never the partner 4%', () => {
  assert.equal(consumerDiscountOf(raw([...PARTNER, SALE])), 15);
});

test('hidden, unused, broken or missing discounts are ignored; the sum is capped at 90', () => {
  assert.equal(consumerDiscountOf(raw([...PARTNER, { ...SALE, can_show: false }])), 0);
  assert.equal(consumerDiscountOf(raw([...PARTNER, { ...SALE, used_in_calc: false }])), 0);
  assert.equal(consumerDiscountOf(raw([{ ...SALE, percent: 'x' }, null])), 0);
  assert.equal(consumerDiscountOf({ code: 1 }), 0);
  assert.equal(consumerDiscountOf(raw([SALE, { ...SALE, percent: 80 }])), 90);
});

test('normalize carries it next to the prices (price stays the price before the sale)', () => {
  const { product } = normalize(raw([...PARTNER, SALE]), { page: 1 });
  assert.equal(product.price, 579000);
  assert.equal(product.consumer_discount_percent, 15);
});
