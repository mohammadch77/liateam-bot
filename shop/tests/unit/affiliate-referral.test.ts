// Task K as pure rules: who may refer whom (ONE level), the typed referral code, the referred person's report (the masked order
// number, the applied percent / fixed amount, the totals) and the Excel file made from it. The database side and the whole flow
// (link -> sign-up -> paid order -> commission, the person's page, the locked code) are in referral-flow.e2e.mjs.
// Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  canEnterReferral,
  checkReferral,
  checkReferrer,
  parseReferralCode,
  type ReferralFacts,
  type UserFacts,
} from '../../src/lib/affiliate/referral.ts';
import {
  maskOrderNumber,
  personTable,
  personTotals,
  ruleLabel,
  type PersonOrder,
} from '../../src/lib/affiliate/report.ts';
import { buildXlsx } from '../../src/server/export/xlsx.ts';
import { MAX_LEVEL, parseRuleForm } from '../../src/lib/commission/validate.ts';

const good: ReferralFacts = { found: true, referrerId: '10', referrerIsAffiliate: true, referrerHasReferrer: false };
const me: UserFacts = { id: '20', hasReferrer: false, isAffiliate: false, hasPaidOrder: false };

test('a code is read from what the customer types: Persian digits, case and spaces; anything else is not a code', () => {
  assert.equal(parseReferralCode('  AbC۱۲۳  '), 'abc123');
  assert.equal(parseReferralCode('abc'), null);
  assert.equal(parseReferralCode('a'.repeat(21)), null);
  assert.equal(parseReferralCode("ab'; drop"), null);
  assert.equal(parseReferralCode('ab cd ef'), null);
  assert.equal(parseReferralCode(undefined), null);
});

test('one level: the code must belong to an active affiliate who was not referred; a plain customer with no referrer and no paid order may use it', () => {
  assert.equal(checkReferral(good, me).ok, true);
  assert.equal(checkReferrer({ ...good, found: false, referrerId: null }).ok, false);
  const notAffiliate = checkReferral({ ...good, referrerIsAffiliate: false }, me);
  assert.ok(!notAffiliate.ok && notAffiliate.reason === 'referrer_not_affiliate');
  const chained = checkReferral({ ...good, referrerHasReferrer: true }, me);
  assert.ok(!chained.ok && chained.reason === 'referrer_is_referred'); // the referrer was referred: no second level
});

test('nobody refers themselves, a referrer is fixed once, an affiliate is never referred, and a paid order closes the door', () => {
  const self = checkReferral(good, { ...me, id: '10' });
  assert.ok(!self.ok && self.reason === 'self');
  const again = checkReferral(good, { ...me, hasReferrer: true });
  assert.ok(!again.ok && again.reason === 'already_referred');
  const aff = checkReferral(good, { ...me, isAffiliate: true });
  assert.ok(!aff.ok && aff.reason === 'user_is_affiliate');
  const paid = checkReferral(good, { ...me, hasPaidOrder: true });
  assert.ok(!paid.ok && paid.reason === 'has_paid_order');
  // the rejection never says which of «no such code» and «not usable» it was (the same message)
  const a = checkReferrer({ ...good, found: false, referrerId: null });
  const b = checkReferral({ ...good, referrerIsAffiliate: false }, me);
  assert.ok(!a.ok && !b.ok && a.message === b.message);
});

test('the field is offered only while it can still work', () => {
  assert.equal(canEnterReferral({ hasReferrer: false, isAffiliate: false, hasPaidOrder: false }), true);
  assert.equal(canEnterReferral({ hasReferrer: true, isAffiliate: false, hasPaidOrder: false }), false);
  assert.equal(canEnterReferral({ hasReferrer: false, isAffiliate: true, hasPaidOrder: false }), false);
  assert.equal(canEnterReferral({ hasReferrer: false, isAffiliate: false, hasPaidOrder: true }), false);
});

test('the rule form accepts level 1 only (a missing level is 1), whatever the browser sends', () => {
  assert.equal(MAX_LEVEL, 1);
  const form = (level?: string) =>
    parseRuleForm({
      get: (n: string) =>
        ({ name: 'قاعده', scope: 'all', kind: 'percent', value: '5', minOrderTotal: '0', holdDays: '3', ...(level === undefined ? {} : { level }) })[n],
    });
  const ok = form();
  assert.ok(ok.ok && ok.value.level === 1);
  assert.ok(form('1').ok);
  assert.equal(form('2').ok, false);
  assert.equal(form('5').ok, false);
});

const order = (n: string, base: number, commission: number | null, status: string | null, kind: 'percent' | 'fixed' | null, value: number | null): PersonOrder => ({
  order_number: n,
  paid_at: new Date('2026-03-05T08:00:00Z'),
  order_status: 'sent',
  base_amount: base,
  items_total: base,
  commission,
  commission_status: status,
  rule_kind: kind,
  rule_value: value,
});

test('the person report: the order number is masked, the rule shows the percent or the fixed amount as it was, the totals skip cancelled commissions', () => {
  assert.equal(maskOrderNumber('AV-100123'), 'AV-••0123');
  assert.equal(maskOrderNumber('whatever'), '••••');
  assert.equal(ruleLabel('percent', 5), '5٪');
  assert.match(ruleLabel('fixed', 20000), /20,000 تومان \(ثابت\)/);
  assert.equal(ruleLabel(null, null), '—');
  const rows = [
    order('AV-100001', 1_000_000, 50_000, 'paid', 'percent', 5),
    order('AV-100002', 500_000, 20_000, 'cancelled', 'fixed', 20000),
    order('AV-100003', 200_000, null, null, null, null),
  ];
  assert.deepEqual(personTotals(rows), { orders: 3, base: 1_700_000, commission: 50_000 });
  const t = personTable('علی (1234)', rows, (s) => s);
  assert.equal(t.rows.length, 3);
  assert.equal(t.headers.length, t.rows[0]!.length);
  assert.equal(t.rows[0]![1], 'AV-••0001');
  assert.equal(t.rows[2]![6], '—');
});

test('the Excel file: a real zip of the parts a spreadsheet needs, right-to-left, texts as plain strings (never a formula), numbers as numbers', () => {
  const nasty = '=HYPERLINK("http://x","y")<&>';
  const bytes = buildXlsx({ title: 't', sheet: 'گزارش', headers: ['نام', 'مبلغ'], rows: [[nasty, 12345], ['ب', 0]] });
  const files = unzipSync(bytes);
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml'])
    assert.ok(files[f], f);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /rightToLeft="1"/);
  assert.match(sheet, /<c r="B2" s="0"><v>12345<\/v><\/c>/); // a number
  assert.match(sheet, /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\("http/); // text, not <f>
  assert.ok(!sheet.includes('<f>'));
  assert.ok(sheet.includes('&lt;&amp;&gt;')); // escaped
  assert.match(strFromU8(files['xl/workbook.xml']!), /name="گزارش"/);
});
