// Which manual discount applies (pure, src/lib/pricing/discounts.ts). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestManual,
  covers,
  isLive,
  type Discount,
  type PricedProduct,
} from '../../src/lib/pricing/discounts.ts';

const now = new Date('2026-10-21T12:00:00Z');
const hour = 3600_000;
const d = (x: Partial<Discount>): Discount => ({
  id: 1,
  scope: 'all',
  targetCode: null,
  kind: 'percent',
  value: 10,
  startsAt: new Date(now.getTime() - hour),
  endsAt: null,
  active: true,
  allowLoss: false,
  campaignId: null,
  campaignActive: null,
  campaignEndsAt: null,
  ...x,
});
const product: PricedProduct = { id: 426, price: 1_000_000, categories: [155, 154], brandCode: 7 };

test('scopes: product, category (any ancestor), brand, all', () => {
  assert.ok(covers(d({ scope: 'product', targetCode: 426 }), product));
  assert.ok(!covers(d({ scope: 'product', targetCode: 160 }), product));
  assert.ok(covers(d({ scope: 'category', targetCode: 154 }), product));
  assert.ok(!covers(d({ scope: 'category', targetCode: 999 }), product));
  assert.ok(covers(d({ scope: 'brand', targetCode: 7 }), product));
  assert.ok(!covers(d({ scope: 'brand', targetCode: 8 }), { ...product, brandCode: null }));
  assert.ok(covers(d({ scope: 'all' }), product));
});

test('the best (largest in toman) live discount wins; discounts are not added together', () => {
  const list = [
    d({ id: 1, scope: 'all', value: 5 }),
    d({ id: 2, scope: 'category', targetCode: 154, value: 12 }),
    d({ id: 3, scope: 'product', targetCode: 426, kind: 'amount', value: 100_000 }), // 10%
  ];
  const m = bestManual(product, list, now);
  assert.equal(m.discountId, 2);
  assert.deepEqual([m.percent, m.amount], [12, 0]);
  const m2 = bestManual(
    product,
    [...list, d({ id: 4, scope: 'brand', targetCode: 7, kind: 'amount', value: 150_000 })],
    now,
  );
  assert.equal(m2.discountId, 4);
  assert.deepEqual([m2.percent, m2.amount], [0, 150_000]);
  // an amount larger than the price is the price at most
  assert.equal(
    bestManual({ ...product, price: 50_000 }, [d({ kind: 'amount', value: 90_000 })], now).amount,
    50_000,
  );
});

test('period: not before its start, not from its end; off / campaign stopped or ended → not live', () => {
  assert.ok(isLive(d({}), now));
  assert.ok(!isLive(d({ startsAt: new Date(now.getTime() + hour) }), now));
  assert.ok(!isLive(d({ endsAt: now }), now));
  assert.ok(isLive(d({ endsAt: new Date(now.getTime() + 1) }), now));
  assert.ok(!isLive(d({ active: false }), now));
  assert.ok(
    !isLive(d({ campaignId: 3, campaignActive: false, campaignEndsAt: new Date(now.getTime() + hour) }), now),
  );
  assert.ok(!isLive(d({ campaignId: 3, campaignActive: true, campaignEndsAt: now }), now));
  assert.ok(
    isLive(d({ campaignId: 3, campaignActive: true, campaignEndsAt: new Date(now.getTime() + hour) }), now),
  );
  assert.equal(bestManual(product, [d({ endsAt: now })], now).discountId, 0);
});

test('a new Liateam price: an amount discount stays an amount, a percent follows the price', () => {
  const amount = d({ kind: 'amount', value: 100_000 });
  assert.equal(bestManual({ ...product, price: 2_000_000 }, [amount], now).amount, 100_000);
  const pct = d({ value: 10 });
  assert.equal(bestManual({ ...product, price: 2_000_000 }, [pct], now).percent, 10);
});
