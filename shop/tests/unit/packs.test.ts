// A pack's shape (pure, src/lib/pricing/packs.ts). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { packLive, packState, savingPercent, type PackProductState } from '../../src/lib/pricing/packs.ts';

const shop: Record<number, PackProductState> = {
  1: { price: 200_000, inStock: true },
  2: { price: 300_000, inStock: true },
  3: { price: 500_000, inStock: false },
};
const lookup = (id: number) => shop[id] ?? null;

test('total of the current prices; every product in stock → available', () => {
  const s = packState(
    [
      { label: 'پاک‌کننده', productId: 1 },
      { label: 'تونر', productId: 2 },
    ],
    lookup,
  );
  assert.equal(s.total, 500_000);
  assert.ok(s.available);
  assert.deepEqual(s.productIds, [1, 2]);
  assert.deepEqual(
    s.steps.map((x) => [x.status, x.price]),
    [
      ['ok', 200_000],
      ['ok', 300_000],
    ],
  );
});

test('a product out of stock or gone → that step «ناموجود», the pack not available (no misleading price)', () => {
  const out = packState(
    [
      { label: 'الف', productId: 1 },
      { label: 'ب', productId: 3 },
    ],
    lookup,
  );
  assert.ok(!out.available);
  assert.equal(out.steps[1]!.status, 'out');
  assert.equal(out.steps[1]!.price, null);
  const gone = packState([{ label: 'الف', productId: 99 }], lookup);
  assert.ok(!gone.available);
});

test('a step without a product is «به‌زودی» and does not block the pack', () => {
  const s = packState(
    [
      { label: 'الف', productId: 1 },
      { label: 'ب', productId: null },
    ],
    lookup,
  );
  assert.ok(s.available);
  assert.equal(s.steps[1]!.status, 'soon');
  assert.equal(s.total, 200_000);
  assert.ok(!packState([{ label: 'الف', productId: null }], lookup).available);
});

test('a new Liateam price changes the total (nothing stored)', () => {
  const before = packState([{ label: 'الف', productId: 1 }], lookup).total;
  const after = packState([{ label: 'الف', productId: 1 }], () => ({ price: 260_000, inStock: true })).total;
  assert.deepEqual([before, after], [200_000, 260_000]);
});

test('saving percent and period', () => {
  assert.equal(savingPercent(1_000_000, 900_000), 10);
  assert.equal(savingPercent(1_000_000, 1_000_000), 0);
  assert.equal(savingPercent(1_000_000, 999_000), 1);
  const now = new Date('2026-10-21T10:00:00Z');
  assert.ok(packLive({ active: true, startsAt: null, endsAt: null }, now));
  assert.ok(!packLive({ active: false, startsAt: null, endsAt: null }, now));
  assert.ok(!packLive({ active: true, startsAt: new Date(now.getTime() + 1), endsAt: null }, now));
  assert.ok(!packLive({ active: true, startsAt: null, endsAt: now }, now));
});
