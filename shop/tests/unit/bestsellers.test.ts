// «پرفروش‌ترین‌ها»: how a tab's list is built (pure, src/lib/bestsellers.ts). Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { BESTSELLER_TABS, composeBestsellers, type BestsellerCandidate } from '../../src/lib/bestsellers.ts';

const day = 86400_000;
const c = (id: number, x: Partial<BestsellerCandidate> = {}): BestsellerCandidate => ({
  id,
  bestSelling: false,
  popular: false,
  reviews: 0,
  rating: 0,
  firstSeen: new Date(2026, 0, 1),
  ...x,
});

test('order: manual picks (in order) → Liateam best-selling → fill-up', () => {
  const list = composeBestsellers(
    [7, 3],
    [c(1), c(2, { bestSelling: true, reviews: 5 }), c(3), c(4, { bestSelling: true, reviews: 50 }), c(7)],
    { useLiateamTag: true },
  );
  assert.deepEqual(
    list.map((x) => `${x.id}:${x.source}`),
    ['7:manual', '3:manual', '4:liateam', '2:liateam', '1:fill'],
  );
});

test('a pick that is not sellable / in stock now (not a candidate) is skipped; nothing twice', () => {
  const list = composeBestsellers([99, 2, 2], [c(1), c(2, { bestSelling: true })], { useLiateamTag: true });
  assert.deepEqual(
    list.map((x) => x.id),
    [2, 1],
  );
});

test('Liateam tag switched off → tagged products only through the fill-up', () => {
  const list = composeBestsellers([], [c(1, { reviews: 9 }), c(2, { bestSelling: true, reviews: 1 })], {
    useLiateamTag: false,
  });
  assert.deepEqual(
    list.map((x) => `${x.id}:${x.source}`),
    ['1:fill', '2:fill'],
  );
});

test('fill-up: popular first, then most reviews, best rating, newest', () => {
  const list = composeBestsellers(
    [],
    [
      c(1, { reviews: 100 }),
      c(2, { popular: true, reviews: 1 }),
      c(3, { reviews: 100, rating: 90 }),
      c(4, { reviews: 100, rating: 90, firstSeen: new Date(2026, 5, 1) }),
    ],
    { useLiateamTag: true },
  );
  assert.deepEqual(
    list.map((x) => x.id),
    [2, 4, 3, 1],
  );
});

test('at most 10, fewer when the tab has fewer products', () => {
  const many = Array.from({ length: 25 }, (_, i) => c(i + 1, { firstSeen: new Date(i * day) }));
  assert.equal(composeBestsellers([], many, { useLiateamTag: true }).length, 10);
  assert.equal(composeBestsellers([], many.slice(0, 3), { useLiateamTag: true }).length, 3);
  assert.equal(composeBestsellers([], [], { useLiateamTag: true }).length, 0);
});

test('tabs as in the design: همه / مراقبت پوست / آرایشی / عطر و بدن / مو و دهان; no category in two tabs', () => {
  assert.deepEqual(
    BESTSELLER_TABS.map((t) => t.label),
    ['همه', 'مراقبت پوست', 'آرایشی', 'عطر و بدن', 'مو و دهان'],
  );
  const all = BESTSELLER_TABS.flatMap((t) => t.categories ?? []);
  assert.equal(new Set(all).size, all.length);
});

test('menus: 6 cards from 1280 px, 4 below; «مشاهده همه» only when there are more', async () => {
  const { navLimit, composeNavProducts } = await import('../../src/lib/bestsellers.ts');
  assert.deepEqual([1024, 1279, 1280, 1440, 1920].map(navLimit), [4, 4, 6, 6, 6]);
  const six = Array.from({ length: 6 }, (_, i) => c(i + 1));
  assert.deepEqual(composeNavProducts([], six, 6), { ids: [1, 2, 3, 4, 5, 6], more: false });
  const r = composeNavProducts([], six, 4);
  assert.equal(r.ids.length, 4);
  assert.equal(r.more, true);
  assert.deepEqual(composeNavProducts([], [], 6), { ids: [], more: false });
  // the same order as the best sellers: Liateam's best-selling tag before the rest
  assert.deepEqual(
    composeNavProducts([], [c(1, { reviews: 9 }), c(2, { bestSelling: true })], 6).ids,
    [2, 1],
  );
});
