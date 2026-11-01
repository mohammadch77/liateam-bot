// The commission engine (pure) and the rule form's validation. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCommissions,
  percentOf,
  type CommissionOrder,
  type CommissionRule,
  type OrderLine,
} from '../../src/lib/commission/engine.ts';
import { parseRuleForm, parseScope } from '../../src/lib/commission/validate.ts';

const NOW = new Date('2026-03-10T10:00:00Z');
let nextId = 1;
const rule = (o: Partial<CommissionRule> = {}): CommissionRule => ({
  id: nextId++,
  name: 'r',
  scope: { type: 'all' },
  level: 1,
  kind: 'percent',
  value: 5,
  minOrderTotal: 0,
  maxPerOrder: null,
  holdDays: 0,
  active: true,
  ...o,
});
const line = (total: number, o: Partial<OrderLine> = {}): OrderLine => ({
  productId: 1,
  brandId: 10,
  categoryIds: [100, 50],
  lineTotal: total,
  ...o,
});
const order = (lines: OrderLine[], o: Partial<CommissionOrder> = {}): CommissionOrder => ({
  lines,
  status: 'paid',
  createdAt: NOW,
  ...o,
});

test('percent of the goods total, rounded DOWN to whole toman, exactly (4 decimals, big orders)', () => {
  assert.equal(percentOf(1_000_000, 5), 50_000);
  assert.equal(percentOf(999, 5), 49); // 49.95 -> 49
  assert.equal(percentOf(1, 99.9999), 0);
  assert.equal(percentOf(333_333, 2.5), 8_333); // 8333.325
  assert.equal(percentOf(9_000_000_000_000, 12.3456), 1_111_104_000_000); // no float drift
  assert.equal(percentOf(100, 0.0001), 0);
});

test('one level: 5% of 1,000,000 toman; shipping is not part of the lines', () => {
  const r = calculateCommissions(
    order([line(600_000), line(400_000, { productId: 2 })]),
    [rule()],
    ['u1'],
    NOW,
  );
  assert.equal(r.goodsTotal, 1_000_000);
  assert.deepEqual(
    r.items.map((i) => [i.level, i.affiliateUserId, i.amount, i.base, i.status]),
    [[1, 'u1', 50_000, 1_000_000, 'pending']],
  );
  assert.deepEqual(r.skipped, []);
});

test('no referrer, no commission; no rule for a level, nothing for that level', () => {
  assert.deepEqual(calculateCommissions(order([line(100_000)]), [rule()], [], NOW), {
    items: [],
    skipped: [],
    goodsTotal: 100_000,
  });
  const r = calculateCommissions(order([line(100_000)]), [rule({ level: 1 })], ['a', 'b'], NOW);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.skipped, [{ level: 2, affiliateUserId: 'b', reason: 'no_rule' }]);
  assert.equal(calculateCommissions(order([line(100_000)]), [], ['a'], NOW).skipped[0]!.reason, 'no_rule');
});

test('several levels: each level has its own rule and referrer', () => {
  const rules = [
    rule({ level: 1, value: 5 }),
    rule({ level: 2, value: 2 }),
    rule({ level: 3, kind: 'fixed', value: 7_000 }),
  ];
  const r = calculateCommissions(order([line(1_000_000)]), rules, ['a', 'b', 'c', 'd'], NOW);
  assert.deepEqual(
    r.items.map((i) => [i.level, i.affiliateUserId, i.amount]),
    [
      [1, 'a', 50_000],
      [2, 'b', 20_000],
      [3, 'c', 7_000],
    ],
  );
  assert.deepEqual(
    r.skipped.map((s) => [s.level, s.reason]),
    [[4, 'no_rule']],
  ); // 4th referrer: no level-4 rule
});

test('priority: product beats brand beats category beats all; a deeper category beats its parent', () => {
  const all = rule({ value: 1 });
  const parent = rule({ scope: { type: 'category', id: 50 }, value: 2 });
  const child = rule({ scope: { type: 'category', id: 100 }, value: 3 });
  const brand = rule({ scope: { type: 'brand', id: 10 }, value: 4 });
  const product = rule({ scope: { type: 'product', id: 1 }, value: 5 });
  const pct = (rules: CommissionRule[]) =>
    calculateCommissions(order([line(1_000_000)]), rules, ['a'], NOW).items[0]?.amount;
  assert.equal(pct([all]), 10_000);
  assert.equal(pct([all, parent]), 20_000);
  assert.equal(pct([all, parent, child]), 30_000);
  assert.equal(pct([all, parent, child, brand]), 40_000);
  assert.equal(pct([all, parent, child, brand, product]), 50_000);
  assert.equal(pct([product, brand, child, parent, all]), 50_000); // order of the list does not matter
});

test('a line goes to its own most specific rule: mixed lines split by rule', () => {
  const all = rule({ value: 1 });
  const brand = rule({ scope: { type: 'brand', id: 10 }, value: 10 });
  const r = calculateCommissions(
    order([
      line(100_000, { productId: 1, brandId: 10 }),
      line(200_000, { productId: 2, brandId: 99, categoryIds: [7] }),
    ]),
    [all, brand],
    ['a'],
    NOW,
  );
  assert.equal(r.items[0]!.amount, 10_000 + 2_000);
  assert.deepEqual(r.items[0]!.ruleIds, [all.id, brand.id]);
  assert.equal(r.items[0]!.base, 300_000);
});

test('equal specificity: the newer rule (higher id) wins', () => {
  const older = rule({ scope: { type: 'brand', id: 10 }, value: 3 });
  const newer = rule({ scope: { type: 'brand', id: 10 }, value: 6 });
  assert.equal(
    calculateCommissions(order([line(100_000)]), [newer, older], ['a'], NOW).items[0]!.amount,
    6_000,
  );
});

test('scope that matches no line pays nothing', () => {
  const r = calculateCommissions(
    order([line(100_000)]),
    [rule({ scope: { type: 'brand', id: 999 } })],
    ['a'],
    NOW,
  );
  assert.deepEqual([r.items.length, r.skipped[0]!.reason], [0, 'no_matching_line']);
  assert.equal(
    calculateCommissions(
      order([line(100_000, { brandId: null })]),
      [rule({ scope: { type: 'brand', id: 10 } })],
      ['a'],
      NOW,
    ).items.length,
    0,
  );
});

test('minimum order total: below it the rule does not apply (a less specific one may)', () => {
  const big = rule({ scope: { type: 'brand', id: 10 }, value: 10, minOrderTotal: 500_000 });
  const base = rule({ value: 1 });
  assert.equal(calculateCommissions(order([line(400_000)]), [big, base], ['a'], NOW).items[0]!.amount, 4_000);
  assert.equal(
    calculateCommissions(order([line(500_000)]), [big, base], ['a'], NOW).items[0]!.amount,
    50_000,
  ); // exactly the minimum counts
  assert.equal(calculateCommissions(order([line(400_000)]), [big], ['a'], NOW).skipped[0]!.reason, 'no_rule');
});

test('the cap limits what one rule pays on one order', () => {
  const capped = rule({ value: 10, maxPerOrder: 30_000 });
  assert.equal(calculateCommissions(order([line(1_000_000)]), [capped], ['a'], NOW).items[0]!.amount, 30_000);
  assert.equal(calculateCommissions(order([line(100_000)]), [capped], ['a'], NOW).items[0]!.amount, 10_000); // under the cap
  const fixedCapped = rule({ kind: 'fixed', value: 50_000, maxPerOrder: 20_000 });
  assert.equal(
    calculateCommissions(order([line(1_000_000)]), [fixedCapped], ['a'], NOW).items[0]!.amount,
    20_000,
  );
});

test('a fixed amount is paid once per order, not per line', () => {
  const fixed = rule({ kind: 'fixed', value: 12_000 });
  assert.equal(
    calculateCommissions(
      order([line(50_000), line(60_000, { productId: 2 }), line(70_000, { productId: 3 })]),
      [fixed],
      ['a'],
      NOW,
    ).items[0]!.amount,
    12_000,
  );
});

test('validity window and inactive rules', () => {
  const windowed = rule({ validFrom: new Date('2026-04-01T00:00:00Z') });
  assert.equal(calculateCommissions(order([line(100_000)]), [windowed], ['a'], NOW).items.length, 0); // not yet valid at the order time
  assert.equal(
    calculateCommissions(
      order([line(100_000)]),
      [rule({ validTo: new Date('2026-03-10T10:00:00Z') })],
      ['a'],
      NOW,
    ).items.length,
    0,
  ); // the end is exclusive
  assert.equal(
    calculateCommissions(
      order([line(100_000)]),
      [rule({ validFrom: new Date('2026-03-01T00:00:00Z'), validTo: new Date('2026-04-01T00:00:00Z') })],
      ['a'],
      NOW,
    ).items.length,
    1,
  );
  assert.equal(
    calculateCommissions(order([line(100_000)]), [rule({ active: false })], ['a'], NOW).items.length,
    0,
  );
});

test('rounding down can leave nothing: zero amounts are skipped, not recorded', () => {
  const r = calculateCommissions(order([line(10)]), [rule({ value: 5 })], ['a'], NOW); // 0.5 toman
  assert.deepEqual([r.items.length, r.skipped[0]!.reason], [0, 'zero_amount']);
});

test('hold and approval: pending until the order is sent and the hold has passed', () => {
  const held = rule({ holdDays: 7 });
  const paid = calculateCommissions(order([line(100_000)]), [held], ['a'], NOW).items[0]!;
  assert.deepEqual([paid.status, paid.approvableAt, paid.holdDays], ['pending', null, 7]);

  const sentAt = new Date('2026-03-05T10:00:00Z'); // 5 days ago
  const early = calculateCommissions(order([line(100_000)], { status: 'sent', sentAt }), [held], ['a'], NOW)
    .items[0]!;
  assert.deepEqual(
    [early.status, early.approvableAt?.toISOString()],
    ['pending', '2026-03-12T10:00:00.000Z'],
  );

  const late = calculateCommissions(
    order([line(100_000)], { status: 'sent', sentAt: new Date('2026-03-03T10:00:00Z') }),
    [held],
    ['a'],
    NOW,
  ).items[0]!;
  assert.equal(late.status, 'approved'); // 7 days passed exactly
  const noHold = calculateCommissions(
    order([line(100_000)], { status: 'sent', sentAt }),
    [rule({ holdDays: 0 })],
    ['a'],
    NOW,
  ).items[0]!;
  assert.equal(noHold.status, 'approved');
});

test('the hold of an item is the longest hold among the rules that paid it', () => {
  const r = calculateCommissions(
    order([line(100_000, { productId: 1 }), line(100_000, { productId: 2, brandId: 99 })]),
    [rule({ holdDays: 3 }), rule({ scope: { type: 'brand', id: 10 }, holdDays: 14 })],
    ['a'],
    NOW,
  );
  assert.equal(r.items[0]!.holdDays, 14);
});

test('cancelled or refunded: every item is cancelled and worth nothing', () => {
  for (const status of ['canceled', 'refunded'] as const) {
    const r = calculateCommissions(
      order([line(1_000_000)], { status }),
      [rule({ level: 1 }), rule({ level: 2, value: 2 })],
      ['a', 'b'],
      NOW,
    );
    assert.deepEqual(
      r.items.map((i) => [i.level, i.status, i.amount, i.base]),
      [
        [1, 'cancelled', 0, 0],
        [2, 'cancelled', 0, 0],
      ],
    );
  }
});

test('lines with a non-positive or fractional total are ignored; the engine never returns a negative amount', () => {
  const r = calculateCommissions(
    order([line(-500), line(0), line(1.5), line(200_000)]),
    [rule()],
    ['a'],
    NOW,
  );
  assert.equal(r.goodsTotal, 200_000);
  assert.equal(r.items[0]!.amount, 10_000);
  assert.ok(r.items.every((i) => i.amount >= 0 && Number.isInteger(i.amount)));
});

test('the engine does not change its inputs', () => {
  const rules = [rule({ level: 1 }), rule({ level: 2 })];
  const o = order([line(100_000)]);
  const before = JSON.stringify([rules, o]);
  calculateCommissions(o, rules, ['a', 'b'], NOW);
  assert.equal(JSON.stringify([rules, o]), before);
});

// ── the admin's rule form ──
const form = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
const good = {
  name: 'پایه',
  scope: 'all',
  scopeId: '',
  level: '1',
  kind: 'percent',
  value: '5',
  minOrderTotal: '0',
  maxPerOrder: '',
  holdDays: '7',
  active: '1',
};

test('rule form: a valid rule, Persian digits, no defaults', () => {
  const r = parseRuleForm(
    form({ ...good, level: '۲', value: '۲٫۵', minOrderTotal: '۵۰۰٬۰۰۰', maxPerOrder: '۱۰۰۰۰۰' }),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(
    [r.value.level, r.value.value, r.value.minOrderTotal, r.value.maxPerOrder, r.value.active],
    [2, 2.5, 500_000, 100_000, true],
  );
  // nothing is filled in for the admin: empty required fields are errors
  for (const blank of ['name', 'level', 'value', 'minOrderTotal', 'holdDays'])
    assert.equal(parseRuleForm(form({ ...good, [blank]: '' })).ok, false, blank);
});

test('rule form: limits and scope', () => {
  const bad = (o: Record<string, string>) =>
    assert.equal(parseRuleForm(form({ ...good, ...o })).ok, false, JSON.stringify(o));
  bad({ level: '0' });
  bad({ level: '6' });
  bad({ value: '0' });
  bad({ value: '100.5' });
  bad({ value: '5.12345' });
  bad({ kind: 'fixed', value: '12.5' });
  bad({ kind: 'weird' });
  bad({ maxPerOrder: '0' });
  bad({ holdDays: '400' });
  bad({ scope: 'brand', scopeId: '' });
  bad({ scope: 'planet', scopeId: '1' });
  bad({ validFrom: '2026-05-01', validTo: '2026-04-01' });
  bad({ validFrom: 'tomorrow' });
  assert.equal(parseRuleForm(form({ ...good, kind: 'fixed', value: '15000' })).ok, true);
  assert.equal(parseRuleForm(form({ ...good, scope: 'product', scopeId: '541' })).ok, true);
  assert.deepEqual(parseScope('all', '123'), { ok: true, value: { type: 'all' } });
  const off = parseRuleForm(form({ ...good, active: '' }));
  assert.ok(off.ok && off.value.active === false);
});
