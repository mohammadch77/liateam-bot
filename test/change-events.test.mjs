import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, fromCatalogEvents, fromSections, groupOf, insertEvents, summarize } from '../src/change-events.mjs';
import { diffCatalog, saveRich, upsertProducts } from '../src/db.mjs';

const COST_OLD = 913_427;
const COST_NEW = 951_233;
const prev = new Map([
  [1, { id: 1, name: 'سرم آبرسان', price: 1_000_000, cost_price: COST_OLD, stock: 5, missing_since: null }],
  [2, { id: 2, name: 'شامپو', price: 500_000, cost_price: 480_000, stock: 3, missing_since: null }],
  [3, { id: 3, name: 'کرم دست', price: 300_000, cost_price: 288_000, stock: 0, missing_since: null }],
  [4, { id: 4, name: 'ریمل', price: 700_000, cost_price: 672_000, stock: 9, missing_since: null }],
]);
const accepted = [
  { id: 1, name: 'سرم آبرسان', price: 1_050_000, cost_price: COST_NEW, stock: 5 }, // price + cost changed
  { id: 2, name: 'شامپو', price: 500_000, cost_price: 499_999, stock: 0 }, // only cost + out of stock
  { id: 3, name: 'کرم دست', price: 300_000, cost_price: 288_000, stock: 4 }, // back in stock
  { id: 5, name: 'رژ لب', price: 450_000, cost_price: 432_000, stock: 7 }, // new
];
const seen = new Set([1, 2, 3, 5]); // 4 removed

test('catalog changes → events; the purchase price never makes one (not even a cost-only change)', () => {
  const rows = fromCatalogEvents(diffCatalog(prev, accepted, seen));
  assert.deepEqual(rows.map((r) => [r.product_code, r.event_type]).sort(), [
    [1, 'price_changed'], [2, 'stock_changed'], [3, 'stock_changed'], [4, 'product_removed'], [5, 'product_added'],
  ]);
  const price = rows.find((r) => r.event_type === 'price_changed');
  assert.deepEqual(price.details, { name: 'سرم آبرسان', old_price_toman: 1_000_000, new_price_toman: 1_050_000 });
  const out = JSON.stringify(rows) + summarize(rows);
  for (const secret of [COST_OLD, COST_NEW, 499_999, 480_000, 432_000]) {
    assert.ok(!out.includes(String(secret)), `cost ${secret} leaked`);
    assert.ok(!out.includes(new Intl.NumberFormat('fa-IR').format(secret)), `cost ${secret} leaked (Persian digits)`);
  }
  assert.ok(!/cost|payable|تمام‌شده|خرید/i.test(out), 'no cost wording');
});

test('no change → no event', () => {
  const same = [...prev.values()].map((p) => ({ ...p }));
  assert.deepEqual(fromCatalogEvents(diffCatalog(prev, same, new Set(prev.keys()))), []);
  assert.deepEqual(fromSections(1, 'x', []), []);
  assert.deepEqual(fromSections(1, 'x', ['meta', 'tags']), []); // rating / tags churn is not news
});

test('one message per batch: counts per type, a few lines each, clipped', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => ({ event_type: 'price_changed', summary_fa: `محصول ${i}: قیمت از … به …` })),
    { event_type: 'description_changed', summary_fa: 'سرم الف' },
    { event_type: 'description_changed', summary_fa: 'سرم ب' },
    { event_type: 'banner_changed', summary_fa: '۸ بنر' },
  ];
  const text = summarize(rows, { maxPerType: 3 });
  assert.match(text, /۵ تغییر قیمت · ۲ تغییر توضیحات · ۱ تغییر بنرهای صفحه‌ی اصلی/);
  assert.equal((text.match(/^• /gm) ?? []).length, 3 + 2 + 1);
  assert.match(text, /… و ۲ مورد دیگر/);
  const long = summarize(Array.from({ length: 400 }, (_, i) => ({ event_type: 'reviews_changed', summary_fa: `محصول شماره‌ی ${i} با نام بلند` })), { maxPerType: 400, maxChars: 1000 });
  assert.ok(long.length <= 1000);
  assert.equal(groupOf('price_changed'), 'price');
  assert.equal(groupOf('sync_backoff'), 'errors');
  assert.ok(Object.values(EVENT_TYPES).every((t) => ['price', 'stock', 'catalog', 'content', 'errors'].includes(t.group)));
});

// a tiny in-memory client: enough SQL to see that events are written inside the same transaction as the change
function fakeDb(hashes) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      const s = sql.trim();
      log.push(s.split(/\s+/).slice(0, 3).join(' '));
      if (s.startsWith('SELECT name, content_hashes')) return { rows: [{ name: 'سرم', content_hashes: hashes }] };
      if (s.startsWith('INSERT INTO change_events')) log.push(`EVENT ${params[3]}`);
      return { rows: [{ inserted: false, changed: false }], rowCount: 0 };
    },
  };
}

test('rich sections: events only for sections that changed after their first fill, inside the transaction', async () => {
  const rich = { summary: 'x', features: [], attributes: [], howToUse: 'new text', video: null, faqs: [], reviews: [], total: 0,
    rating: 90, brandCode: null, country: null, gallery: [], concerns: [], tags: [] };
  const db = fakeDb({ how_to_use: 'old', faqs: 'same' }); // how_to_use existed; summary never filled before
  const changed = await saveRich(db, 7, rich, { how_to_use: 'new', faqs: 'same', summary: 'first' });
  assert.deepEqual(changed.sort(), ['how_to_use', 'summary']);
  const events = db.log.filter((l) => l.startsWith('EVENT'));
  assert.deepEqual(events, ['EVENT how_to_use_changed']); // the first fill of «summary» is not a change
  assert.ok(db.log.indexOf('BEGIN') < db.log.indexOf('EVENT how_to_use_changed'));
  assert.ok(db.log.indexOf('EVENT how_to_use_changed') < db.log.indexOf('COMMIT'));
});

test('catalog: the events callback runs before COMMIT (one transaction with the prices)', async () => {
  const db = fakeDb({});
  await upsertProducts(db, [{ id: 1, uuid: null, name: 'x', price: 1, cost_price: 1, stock: 1, category: [], is_available: true, is_sellable: true }],
    async (tx) => insertEvents(tx, [{ entity_type: 'product', entity_id: '1', product_code: 1, event_type: 'price_changed', summary_fa: 'x', details: {} }]));
  const iEvent = db.log.indexOf('EVENT price_changed');
  assert.ok(iEvent > db.log.indexOf('BEGIN') && iEvent < db.log.indexOf('COMMIT'));
});
