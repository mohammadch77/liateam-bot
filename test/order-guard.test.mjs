import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPlacement, botWalletApplies, originOf, toleranceFrom } from '../src/order-guard.mjs';

const items = [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1 }];
const live = (over = {}) => new Map([
  [1, { valid: true, inventory: 10, price: 100_000, ...over[1] }],
  [2, { valid: true, inventory: 5, price: 50_000, ...over[2] }],
]);
// goods 2 x 100 000 + 50 000, shipping 30 000
const base = { expectedTotal: 280_000, tolerance: 10, items, shippingPrice: 30_000 };

test('same total: placed', () => {
  assert.deepEqual(assessPlacement({ ...base, liveProducts: live() }), { ok: true, liveTotal: 280_000 });
});

test('difference within the tolerance (both directions) is placed; beyond it stops', () => {
  assert.equal(assessPlacement({ ...base, liveProducts: live({ 2: { price: 50_010 } }) }).ok, true); // +10
  assert.equal(assessPlacement({ ...base, liveProducts: live({ 2: { price: 49_990 } }) }).ok, true); // -10
  const up = assessPlacement({ ...base, liveProducts: live({ 2: { price: 50_011 } }) });
  assert.deepEqual([up.ok, up.reason, up.diff], [false, 'price', 11]);
  const down = assessPlacement({ ...base, liveProducts: live({ 1: { price: 90_000 } }) });
  assert.deepEqual([down.ok, down.reason, down.diff], [false, 'price', -20_000]);
});

test('the tolerance is a setting', () => {
  const moved = live({ 2: { price: 50_500 } });
  assert.equal(assessPlacement({ ...base, liveProducts: moved }).ok, false);
  assert.equal(assessPlacement({ ...base, tolerance: 500, liveProducts: moved }).ok, true);
  assert.equal(toleranceFrom(undefined), 10);
  assert.equal(toleranceFrom(null, 25), 25);
  assert.equal(toleranceFrom('abc', 25), 25);
  assert.equal(toleranceFrom(-1), 10);
  assert.equal(toleranceFrom(0), 0);
  assert.equal(toleranceFrom(75), 75);
});

test('a changed shipping price counts too', () => {
  assert.equal(assessPlacement({ ...base, shippingPrice: 31_000, liveProducts: live() }).reason, 'price');
});

test('an item out of stock, short, or no longer valid stops the order (even at the same price)', () => {
  for (const over of [{ 1: { inventory: 0 } }, { 1: { inventory: 1 } }, { 2: { valid: false } }]) {
    const r = assessPlacement({ ...base, liveProducts: live(over) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unavailable');
    assert.ok(r.missing.length >= 1);
  }
  const gone = live();
  gone.delete(2);
  assert.deepEqual(assessPlacement({ ...base, liveProducts: gone }).missing, [2]);
});

test('no expected_total (an admin pressed the button): no check, the old behaviour', () => {
  const r = assessPlacement({ ...base, expectedTotal: null, liveProducts: live({ 1: { inventory: 0 } }) });
  assert.deepEqual(r, { ok: true, liveTotal: null });
});

test('shop-origin orders never use the bot wallet; others do', () => {
  assert.equal(originOf('shop'), 'shop');
  assert.equal(originOf('telegram:Ali'), 'bot');
  assert.equal(originOf(undefined), 'bot');
  assert.equal(botWalletApplies('shop'), false);
  assert.equal(botWalletApplies('bot'), true);
});
