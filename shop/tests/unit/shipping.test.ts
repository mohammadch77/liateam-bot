// Free shipping above a goods total (src/lib/shipping.ts) and the order-flow settings (src/lib/orders/settings.ts).
// Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { freeShippingFrom, quoteShipping } from '../../src/lib/shipping.ts';
import {
  DEFAULT_ORDER_SETTINGS,
  insideAutoPlaceHours,
  parseOrderSettings,
} from '../../src/lib/orders/settings.ts';

const on = { enabled: true, fromToman: 999_000 };
const off = { enabled: false, fromToman: 999_000 };

test("switch off: the customer always pays Liateam's shipping, nothing is absorbed", () => {
  assert.deepEqual(quoteShipping(187_900, 5_000_000, off), {
    supplierPrice: 187_900,
    charged: 187_900,
    absorbed: 0,
    free: false,
  });
});

test("switch on: below the threshold the customer pays; from the threshold on it is free and the shop absorbs Liateam's price", () => {
  assert.deepEqual(quoteShipping(187_900, 998_999, on), {
    supplierPrice: 187_900,
    charged: 187_900,
    absorbed: 0,
    free: false,
  });
  assert.deepEqual(quoteShipping(187_900, 999_000, on), {
    supplierPrice: 187_900,
    charged: 0,
    absorbed: 187_900,
    free: true,
  });
  assert.deepEqual(quoteShipping(187_900, 2_855_040, on), {
    supplierPrice: 187_900,
    charged: 0,
    absorbed: 187_900,
    free: true,
  });
});

test('the three numbers always add up: supplier = charged + absorbed', () => {
  for (const [price, goods] of [
    [0, 1_000_000],
    [187_900, 500_000],
    [187_900, 1_000_000],
    [1, 999_000],
  ] as const) {
    const q = quoteShipping(price, goods, on);
    assert.equal(q.charged + q.absorbed, q.supplierPrice);
  }
});

test('a bad number is refused, a zero threshold never makes shipping free', () => {
  assert.throws(() => quoteShipping(-1, 100, on), RangeError);
  assert.throws(() => quoteShipping(100.5, 100, on), RangeError);
  assert.throws(() => quoteShipping(100, Number.NaN, on), RangeError);
  assert.equal(quoteShipping(100, 5, { enabled: true, fromToman: 0 }).free, false);
});

test('the header promise exists only while the switch is on', () => {
  assert.equal(freeShippingFrom(off), null);
  assert.equal(freeShippingFrom(on), 999_000);
  assert.equal(freeShippingFrom({ enabled: true, fromToman: 0 }), null);
});

test('settings: the starting values; a missing or malformed value falls back to the default', () => {
  assert.deepEqual(parseOrderSettings(new Map()), DEFAULT_ORDER_SETTINGS);
  assert.equal(DEFAULT_ORDER_SETTINGS.priceToleranceToman, 10);
  assert.equal(DEFAULT_ORDER_SETTINGS.autoPlaceEnabled, false);
  assert.equal(DEFAULT_ORDER_SETTINGS.freeShipping.enabled, false);
  assert.equal(DEFAULT_ORDER_SETTINGS.freeShipping.fromToman, 999_000);
  const bad = parseOrderSettings(
    new Map<string, unknown>([
      ['orders.price_tolerance_toman', -5],
      ['orders.auto_place_enabled', 'yes'],
      ['orders.auto_place_hours', { from: '9am', to: '21:00' }],
      ['shipping.free_enabled', 1],
      ['shipping.free_from_toman', 'x'],
    ]),
  );
  assert.deepEqual(bad, DEFAULT_ORDER_SETTINGS);
  const set = parseOrderSettings(
    new Map<string, unknown>([
      ['orders.price_tolerance_toman', 50],
      ['orders.auto_place_enabled', true],
      ['orders.auto_place_hours', { from: '08:30', to: '20:00' }],
      ['shipping.free_enabled', true],
      ['shipping.free_from_toman', 1_500_000],
    ]),
  );
  assert.deepEqual(set, {
    priceToleranceToman: 50,
    autoPlaceEnabled: true,
    autoPlaceHours: { from: '08:30', to: '20:00' },
    freeShipping: { enabled: true, fromToman: 1_500_000 },
  });
});

test('working hours: inside, outside, and a window that wraps past midnight', () => {
  const day = { from: '09:00', to: '21:00' };
  assert.equal(insideAutoPlaceHours(day, 9 * 60), true);
  assert.equal(insideAutoPlaceHours(day, 20 * 60 + 59), true);
  assert.equal(insideAutoPlaceHours(day, 21 * 60), false);
  assert.equal(insideAutoPlaceHours(day, 3 * 60), false);
  const night = { from: '20:00', to: '02:00' };
  assert.equal(insideAutoPlaceHours(night, 23 * 60), true);
  assert.equal(insideAutoPlaceHours(night, 60), true);
  assert.equal(insideAutoPlaceHours(night, 12 * 60), false);
  assert.equal(insideAutoPlaceHours({ from: '00:00', to: '00:00' }, 600), true);
});
