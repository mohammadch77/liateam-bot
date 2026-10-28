// The cart's arithmetic (src/lib/cart/totals.ts), the checkout's verdict and order draft (src/lib/orders/review.ts) and the
// delivery window (src/lib/orders/delivery.ts): pure functions, no database. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capQuantity,
  discountPercentOf,
  maxQuantity,
  mergeCartItems,
  totalsOf,
} from '../../src/lib/cart/totals.ts';
import { deliveryWindow, etaText } from '../../src/lib/orders/delivery.ts';
import { assessReview, buildOrderDraft, type ReviewResult } from '../../src/lib/orders/review.ts';
import type { PricedLine } from '../../src/lib/cart/totals.ts';

test('the most a line can hold: the stock, never above 50, never negative', () => {
  assert.equal(maxQuantity(3), 3);
  assert.equal(maxQuantity(500), 50);
  assert.equal(maxQuantity(0), 0);
  assert.equal(maxQuantity(-4), 0);
  assert.equal(maxQuantity(Number.NaN), 0);
  assert.equal(capQuantity(10, 4), 4);
  assert.equal(capQuantity(2.9, 10), 2);
  assert.equal(capQuantity(-1, 10), 0);
  assert.equal(capQuantity(Number.NaN, 10), 0);
  assert.equal(capQuantity(99, 999), 50);
});

const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  productId: 1,
  name: 'Item',
  href: '/shop/product/item-1',
  imageUrl: null,
  quantity: 1,
  unitPrice: 960_000,
  unitListPrice: 1_000_000,
  stockCount: 10,
  ...over,
});

test("totals: units, goods at the shop price, at Liateam's list price, and the discount between them", () => {
  const t = totalsOf([
    line({ quantity: 2 }),
    line({ productId: 2, quantity: 1, unitPrice: 500_000, unitListPrice: 500_000 }),
  ]);
  assert.deepEqual(t, {
    units: 3,
    lines: 2,
    itemsTotal: 2_420_000,
    listTotal: 2_500_000,
    discountTotal: 80_000,
  });
  assert.deepEqual(totalsOf([]), { units: 0, lines: 0, itemsTotal: 0, listTotal: 0, discountTotal: 0 });
  // a price above the list price never makes a negative discount
  assert.equal(totalsOf([line({ unitPrice: 1_100_000 })]).discountTotal, 0);
});

test('discount percent label', () => {
  assert.equal(discountPercentOf(960_000, 1_000_000), 4);
  assert.equal(discountPercentOf(1_000_000, 1_000_000), 0);
  assert.equal(discountPercentOf(5, 0), 0);
});

test("merging the guest cart into the user's: quantities add up, held at the stock, gone products dropped", () => {
  const stock: Record<number, number> = { 1: 10, 2: 3, 3: 0 };
  const merged = mergeCartItems(
    [
      { productId: 1, quantity: 4 },
      { productId: 2, quantity: 2 },
    ],
    [
      { productId: 1, quantity: 5 },
      { productId: 2, quantity: 5 },
      { productId: 3, quantity: 1 },
      { productId: 4, quantity: 2 },
    ],
    (id) => stock[id] ?? 0,
  );
  assert.deepEqual(merged, [
    { productId: 1, quantity: 9 },
    { productId: 2, quantity: 3 },
  ]); // 3 has no stock, 4 is unknown
  assert.deepEqual(
    mergeCartItems([], [], () => 5),
    [],
  );
  // the limit of 50 applies even with a big stock
  assert.deepEqual(
    mergeCartItems([{ productId: 1, quantity: 40 }], [{ productId: 1, quantity: 40 }], () => 500),
    [{ productId: 1, quantity: 50 }],
  );
});

test("delivery window: the province's range wins over the method's, plus the admin's extra days", () => {
  const from = new Date('2026-10-28T00:00:00Z');
  assert.equal(deliveryWindow(null, null, 1, from), null); // no range entered yet
  const w = deliveryWindow({ minDays: 2, maxDays: 5 }, null, 1, from)!;
  assert.deepEqual([w.minDays, w.maxDays], [3, 6]);
  assert.equal(w.earliest.toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(w.latest.toISOString(), '2026-11-03T00:00:00.000Z');
  const r = deliveryWindow({ minDays: 2, maxDays: 5 }, { minDays: 4, maxDays: 8 }, 0, from)!;
  assert.deepEqual([r.minDays, r.maxDays], [4, 8]);
  assert.deepEqual(deliveryWindow({ minDays: 1, maxDays: 1 }, null, -3, from)!.minDays, 1); // a negative N is 0
  assert.equal(etaText({ minDays: 3, maxDays: 6 }), '3 تا 6 روز');
  assert.equal(etaText({ minDays: 2, maxDays: 2 }), '2 روز');
});

// ── the live check ──
const NOW = new Date('2026-10-28T10:00:00Z');
const later = '2026-10-28T10:15:00Z';
const review = (over: Partial<ReviewResult> = {}): ReviewResult => ({
  ok: true,
  reason: null,
  city_id: 5,
  items: [
    {
      product_id: 1,
      name: 'A',
      requested: 2,
      quantity: 2,
      status: 'ok',
      unit_price: 1_000_000,
      line_total: 2_000_000,
    },
    {
      product_id: 2,
      name: 'B',
      requested: 1,
      quantity: 1,
      status: 'ok',
      unit_price: 500_000,
      line_total: 500_000,
    },
  ],
  shipping: { price: 187_900, title: 'پست' },
  items_total: 2_500_000,
  total: 2_687_900,
  urgent: false,
  expires_at: later,
  ...over,
});
const cart = (): PricedLine[] => [
  line({ productId: 1, quantity: 2, unitPrice: 960_000, unitListPrice: 1_000_000 }),
  line({ productId: 2, name: 'B', quantity: 1, unitPrice: 480_000, unitListPrice: 500_000 }),
];
const free = { enabled: false, fromToman: 999_000 };

test('a good check: every line ok, the order can be made', () => {
  const v = assessReview(cart(), review(), NOW);
  assert.equal(v.canOrder, true);
  assert.deepEqual([v.unavailable, v.adjusted, v.expired], [[], [], false]);
});

test('a line out of stock, a line short, and an expired hold each stop the order and say what to do', () => {
  const out = review({
    items: [
      { product_id: 1, name: 'A', requested: 2, quantity: 0, status: 'unavailable' },
      review().items[1]!,
    ],
  });
  const v1 = assessReview(cart(), out, NOW);
  assert.deepEqual([v1.canOrder, v1.unavailable], [false, [1]]);
  const short = review({
    items: [
      { product_id: 1, name: 'A', requested: 2, quantity: 1, status: 'adjusted', unit_price: 1_000_000 },
      review().items[1]!,
    ],
  });
  const v2 = assessReview(cart(), short, NOW);
  assert.deepEqual([v2.canOrder, v2.adjusted], [false, [{ productId: 1, quantity: 1 }]]);
  const v3 = assessReview(cart(), review({ expires_at: '2026-10-28T09:59:59Z' }), NOW);
  assert.deepEqual([v3.canOrder, v3.expired], [false, true]);
  // the bot says the basket cannot be placed at all
  assert.equal(
    assessReview(cart(), review({ ok: false, reason: 'ارسال پستی به این شهر ممکن نیست' }), NOW).canOrder,
    false,
  );
  // the cart has a product the check does not know (changed after the check)
  assert.equal(assessReview([...cart(), line({ productId: 9 })], review(), NOW).canOrder, false);
});

test('price changed at Liateam is reported on the line', () => {
  const r = review();
  r.items[0] = { ...r.items[0]!, price_changed: { old: 950_000, new: 1_000_000 } };
  const v = assessReview(cart(), r, NOW);
  assert.deepEqual(v.lines[0]!.priceChanged, { old: 950_000, new: 1_000_000 });
});

test("the order draft: goods at the shop price, shipping at Liateam's, expected total in Liateam's prices", () => {
  const r = buildOrderDraft(cart(), review(), free, NOW);
  assert.ok(r.ok);
  if (!r.ok) return;
  const d = r.draft;
  assert.equal(d.itemsTotal, 2 * 960_000 + 480_000); // 2 400 000
  assert.equal(d.discountTotal, 100_000); // Liateam's goods 2 500 000 − 2 400 000
  assert.deepEqual(d.shipping, { supplierPrice: 187_900, charged: 187_900, absorbed: 0, free: false });
  assert.equal(d.totalPayable, 2_587_900);
  assert.equal(d.expectedTotal, 2_687_900); // the bot compares this with Liateam's live total before placing
});

test('free shipping above the threshold: the customer pays 0, the real price is kept as absorbed', () => {
  const r = buildOrderDraft(cart(), review(), { enabled: true, fromToman: 2_400_000 }, NOW);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.draft.shipping, { supplierPrice: 187_900, charged: 0, absorbed: 187_900, free: true });
  assert.equal(r.draft.totalPayable, 2_400_000);
  assert.equal(r.draft.expectedTotal, 2_687_900); // the supplier side does not change
  // one toman under the threshold: still paid
  const under = buildOrderDraft(cart(), review(), { enabled: true, fromToman: 2_400_001 }, NOW);
  assert.ok(under.ok && under.draft.shipping.charged === 187_900);
});

test("the draft is refused when the check is not ok, expired, not the cart's, stale in price or inconsistent", () => {
  const reason = (rv: ReviewResult, lines = cart()) => {
    const r = buildOrderDraft(lines, rv, free, NOW);
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason(review({ ok: false })), 'not_ok');
  assert.equal(reason(review({ shipping: null })), 'not_ok');
  assert.equal(reason(review({ expires_at: '2026-10-28T09:00:00Z' })), 'expired');
  assert.equal(reason(review(), [cart()[0]!]), 'cart_changed');
  assert.equal(reason(review(), []), 'cart_changed');
  const adjusted = review();
  adjusted.items[0] = { ...adjusted.items[0]!, quantity: 1, status: 'adjusted' };
  assert.equal(reason(adjusted), 'cart_changed');
  // the cart shows another list price than the check read at Liateam
  assert.equal(
    reason(review(), [
      cart()[0]!,
      line({ productId: 2, quantity: 1, unitPrice: 480_000, unitListPrice: 510_000 }),
    ]),
    'stale_price',
  );
  assert.equal(reason(review({ total: 2_687_901 })), 'inconsistent');
  assert.equal(reason(review({ items_total: 2_499_999 })), 'inconsistent');
});

test("a shop price above Liateam's list price is held at the list price (never charged more than Liateam)", () => {
  const r = buildOrderDraft(
    [line({ productId: 1, quantity: 2, unitPrice: 1_100_000, unitListPrice: 1_000_000 }), cart()[1]!],
    review(),
    free,
    NOW,
  );
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.draft.items[0]!.unitPrice, 1_000_000);
});

// ── the one snapshot every cart view shares (src/lib/cart/snapshot.ts) ──
import { EMPTY_SNAPSHOT, newer, snapshotOf, withQuantity, type SnapshotLine } from '../../src/lib/cart/snapshot.ts';

const sl = (over: Partial<SnapshotLine> = {}): SnapshotLine => ({
  productId: 1,
  name: 'Item',
  href: '/shop/product/item-1',
  imageUrl: null,
  quantity: 2,
  maxQuantity: 5,
  unitPrice: 960_000,
  unitListPrice: 1_000_000,
  discountPercent: 4,
  lineTotal: 1_920_000,
  ...over,
});

test('snapshot: the totals follow the lines', () => {
  const snap = snapshotOf(10, [sl(), sl({ productId: 2, quantity: 1, unitPrice: 500_000, unitListPrice: 500_000, lineTotal: 500_000 })]);
  assert.deepEqual([snap.units, snap.lines, snap.itemsTotal, snap.listTotal, snap.discountTotal], [3, 2, 2_420_000, 2_500_000, 80_000]);
  assert.deepEqual(EMPTY_SNAPSHOT.items, []);
});

test('snapshot: the newer one wins (a tie goes to the first: the one carrying an optimistic change)', () => {
  const a = snapshotOf(5, [sl()]);
  const b = snapshotOf(9, []);
  assert.equal(newer(a, b), b);
  assert.equal(newer(b, a), b);
  const tieA = snapshotOf(5, [sl({ quantity: 3 })]);
  assert.equal(newer(tieA, a), tieA);
  assert.equal(newer(null, a), a);
  assert.equal(newer(a, undefined), a);
  assert.equal(newer(null, null), null);
});

test('optimistic change: + / − / remove / the stock cap, totals recomputed, rev kept', () => {
  const base = snapshotOf(7, [sl(), sl({ productId: 2, quantity: 1, maxQuantity: 1, unitPrice: 100, unitListPrice: 100, lineTotal: 100 })]);
  const up = withQuantity(base, 1, 3);
  assert.deepEqual([up.rev, up.units, up.items[0]!.quantity, up.items[0]!.lineTotal, up.itemsTotal], [7, 4, 3, 2_880_000, 2_880_100]);
  assert.equal(withQuantity(base, 1, 99).items[0]!.quantity, 5); // held at that line's maximum
  const gone = withQuantity(base, 1, 0);
  assert.deepEqual([gone.items.map((i) => i.productId), gone.units, gone.itemsTotal], [[2], 1, 100]);
  assert.equal(withQuantity(base, 2, 2).items[1]!.quantity, 1); // its maximum is 1
  assert.equal(withQuantity(base, 77, 3).items.length, 2); // an unknown product changes nothing
  assert.equal(base.items[0]!.quantity, 2); // the base is not modified
});

test('mini-cart and cart page agree: the same lines give the same total however they are reached', () => {
  // the scenario of the report: toner 2 (not 1), no gel — one snapshot, one answer
  const server = snapshotOf(20, [sl({ productId: 10, quantity: 2, unitPrice: 2_000_000, unitListPrice: 2_000_000, lineTotal: 4_000_000 })]);
  const stale = snapshotOf(10, [
    sl({ productId: 10, quantity: 1, unitPrice: 2_000_000, unitListPrice: 2_000_000, lineTotal: 2_000_000 }),
    sl({ productId: 11, quantity: 1, unitPrice: 500_000, unitListPrice: 500_000, lineTotal: 500_000 }),
  ]);
  for (const [a, b] of [[stale, server], [server, stale]] as const) {
    const shown = newer(a, b)!;
    assert.deepEqual([shown.units, shown.itemsTotal], [2, 4_000_000]);
  }
});
