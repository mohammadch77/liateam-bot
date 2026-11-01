// The settings registry (validation, defaults, form parsing), the secret box (AES-256-GCM) and the shipping form's parser:
// pure functions, no database. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildKeyRing, open, parseKeyHex, seal } from '../../src/lib/crypto/secret-box.ts';
import {
  GROUPS,
  SECRET_KEYS,
  SETTINGS,
  SETTING_KEYS,
  fromFormField,
  keysOf,
  maskSecret,
  parseStored,
  secretHint,
  toLatinDigits,
  validateSetting,
} from '../../src/lib/settings/registry.ts';
import { parseRange, parseShippingForm } from '../../src/lib/shipping-rules.ts';

const form = (o: Record<string, string | string[]>) => ({
  get: (n: string) => (Array.isArray(o[n]) ? o[n][0] : o[n]) ?? null,
  getAll: (n: string) => (o[n] === undefined ? [] : Array.isArray(o[n]) ? o[n] : [o[n]]),
  has: (n: string) => n in o,
});

// ── secret box ──
const hex = () => randomBytes(32).toString('hex');
const ring = () => buildKeyRing(hex(), 1)!;

test('a secret survives the round trip, and its ciphertext does not contain it', () => {
  const r = ring();
  const sealed = seal(r, 'sms.api_key', 'my-very-secret-key-1234');
  assert.equal(open(r, 'sms.api_key', sealed), 'my-very-secret-key-1234');
  assert.equal(sealed.keyVersion, 1);
  assert.equal(sealed.nonce.length, 12);
  assert.ok(!sealed.ciphertext.toString('latin1').includes('secret'));
  assert.ok(!sealed.ciphertext.toString('hex').includes(Buffer.from('my-very').toString('hex')));
});

test('every encryption gets a new nonce (the same value seals differently)', () => {
  const r = ring();
  const nonces = new Set<string>();
  const bodies = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const s = seal(r, 'k.a', 'same value 123456');
    nonces.add(s.nonce.toString('hex'));
    bodies.add(s.ciphertext.toString('hex'));
  }
  assert.equal(nonces.size, 200);
  assert.equal(bodies.size, 200);
});

test("a wrong key, another setting's key name or altered data cannot open it — and the error leaks nothing", () => {
  const r = ring();
  const sealed = seal(r, 'sms.api_key', 'topsecretvalue-9999');
  const wrong = { current: 1, keys: new Map([[1, randomBytes(32)]]) };
  assert.throws(
    () => open(wrong, 'sms.api_key', sealed),
    (e: Error) => !/topsecret|9999/.test(e.message),
  );
  assert.throws(() => open(r, 'payment.merchant_id', sealed), /cannot be opened/); // bound to its key name
  const flipped = Buffer.from(sealed.ciphertext);
  flipped[0] = (flipped[0] ?? 0) ^ 1;
  assert.throws(() => open(r, 'sms.api_key', { ...sealed, ciphertext: flipped }), /cannot be opened/);
  assert.throws(() => open(r, 'sms.api_key', { ...sealed, keyVersion: 7 }), /no key for version 7/);
});

test('key rotation: old rows still open with the old key, new rows use the new version', () => {
  const [oldHex, newHex] = [hex(), hex()];
  const v1 = buildKeyRing(oldHex, 1)!;
  const sealedOld = seal(v1, 'k.a', 'written before rotation');
  const v2 = buildKeyRing(newHex, 2, `1:${oldHex}`)!;
  assert.equal(open(v2, 'k.a', sealedOld), 'written before rotation');
  const sealedNew = seal(v2, 'k.a', 'written after');
  assert.equal(sealedNew.keyVersion, 2);
  assert.equal(open(v2, 'k.a', sealedNew), 'written after');
  assert.throws(() => open(v1, 'k.a', sealedNew)); // the old ring cannot open the new row
});

test('the key must be exactly 32 bytes of hex; without it secrets are off', () => {
  assert.equal(buildKeyRing(undefined), null);
  assert.equal(buildKeyRing(''), null);
  assert.equal(buildKeyRing('abc'), null);
  assert.equal(buildKeyRing('z'.repeat(64)), null);
  assert.equal(buildKeyRing(hex(), 0), null);
  assert.equal(buildKeyRing(hex(), 1, 'garbage'), null);
  assert.equal(parseKeyHex('a'.repeat(63)), null);
  assert.ok(parseKeyHex('A'.repeat(64)));
});

test('a secret is shown only masked: the last 4 of a long one, nothing of a short one', () => {
  assert.equal(secretHint('abcdefghijkl1234'), '1234');
  assert.equal(secretHint('short-key'), '');
  assert.equal(maskSecret('1234'), '••••1234');
  assert.equal(maskSecret(''), '••••');
});

// ── registry ──
test('every setting has a Persian label, a group and a default that passes its own validation', () => {
  assert.ok(SETTING_KEYS.length >= 12);
  for (const k of SETTING_KEYS) {
    const d = SETTINGS[k];
    assert.equal(d.key, k);
    assert.ok(d.label.length > 2, k);
    assert.ok(
      GROUPS.some((g) => g.id === d.group),
      k,
    );
    if (d.kind === 'secret') {
      assert.equal(d.exposure, 'secret');
      continue;
    }
    assert.equal(validateSetting(k, d.default).ok, true, `${k} default is valid`);
  }
  assert.deepEqual([...SECRET_KEYS].sort(), ['payment.api_key', 'payment.merchant_id', 'sms.api_key']);
});

test('the settings that already existed are registered with their old defaults', () => {
  for (const k of [
    'orders.price_tolerance_toman',
    'orders.auto_place_enabled',
    'orders.auto_place_hours',
    'shipping.free_enabled',
    'shipping.free_from_toman',
    'shipping.extra_days',
    'seo.block_indexing',
    'pricing.discount_mode',
  ] as const)
    assert.ok(k in SETTINGS, k);
  assert.equal(SETTINGS['orders.price_tolerance_toman'].default, 10);
  assert.equal(SETTINGS['shipping.extra_days'].default, 1);
  assert.equal(SETTINGS['shipping.free_from_toman'].default, 999_000);
  assert.deepEqual(SETTINGS['orders.auto_place_hours'].default, { from: '09:00', to: '21:00' });
  assert.equal(SETTINGS['seo.block_indexing'].default, true);
  assert.ok(keysOf('shipping').includes('shipping.extra_days'));
});

test('validation: ranges, formats and Persian messages', () => {
  assert.equal(validateSetting('orders.price_tolerance_toman', 500).ok, true);
  assert.equal(validateSetting('orders.price_tolerance_toman', -1).ok, false);
  assert.equal(validateSetting('orders.price_tolerance_toman', 1.5).ok, false);
  assert.equal(validateSetting('orders.price_tolerance_toman', Number.NaN).ok, false);
  const bad = validateSetting('shipping.extra_days', 31);
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /روزهای اضافه/);
  assert.equal(validateSetting('shipping.free_from_toman', 0).ok, false);
  assert.equal(validateSetting('orders.auto_place_hours', { from: '09:00', to: '24:00' }).ok, false);
  assert.equal(validateSetting('orders.auto_place_hours', { from: '22:00', to: '06:00' }).ok, true); // wraps midnight
  assert.equal(validateSetting('pricing.discount_mode', 'nonsense').ok, false);
  assert.equal(validateSetting('security.admin_session_hours', 0).ok, false);
  assert.equal(validateSetting('security.admin_session_hours', 8).ok, true);
});

test('site base URL: an https origin only (http only for localhost), trailing slash dropped, empty = unset', () => {
  const ok = (v: string) => validateSetting('site.base_url', v);
  assert.deepEqual(ok('https://shop.example.com/'), { ok: true, value: 'https://shop.example.com' });
  assert.deepEqual(ok(''), { ok: true, value: '' });
  assert.equal(ok('http://shop.example.com').ok, false);
  assert.equal(ok('http://localhost:3850').ok, true);
  assert.equal(ok('https://shop.example.com/path').ok, false);
  assert.equal(ok('https://u:p@shop.example.com').ok, false);
  assert.equal(ok('https://shop.example.com?x=1').ok, false);
  assert.equal(ok('javascript:alert(1)').ok, false);
  assert.equal(ok('not a url').ok, false);
});

test('secret values are validated without echoing them', () => {
  const r = validateSetting('sms.api_key', 'short');
  assert.equal(r.ok, false);
  assert.ok(!(!r.ok && r.error.includes('short')));
  assert.equal(validateSetting('sms.api_key', 'has a space inside it').ok, false);
  assert.equal(validateSetting('sms.api_key', 'a-proper-secret-1234').ok, true);
});

test("stored values: a bad or missing one is the default, the first version's discount names still read", () => {
  assert.equal(parseStored('shipping.extra_days', 'x'), 1);
  assert.equal(parseStored('shipping.extra_days', undefined), 1);
  assert.equal(parseStored('shipping.extra_days', 3), 3);
  assert.equal(parseStored('orders.auto_place_enabled', 'yes'), false);
  assert.equal(parseStored('seo.block_indexing', false), false);
  assert.equal(parseStored('pricing.discount_mode', 'liateam'), 'consumer');
  assert.equal(parseStored('pricing.discount_mode', 'excess'), 'beyond_base');
  assert.deepEqual(parseStored('orders.auto_place_hours', { from: 'x' }), { from: '09:00', to: '21:00' });
});

test('form fields: Persian digits and separators, an unticked box is false, times are padded', () => {
  assert.equal(toLatinDigits('۱٬۲۳۴'), '1234');
  assert.equal(toLatinDigits('٣٤'), '34');
  assert.equal(
    fromFormField('shipping.free_from_toman', form({ 'shipping.free_from_toman': '۱٬۵۰۰٬۰۰۰' })),
    1_500_000,
  );
  assert.ok(Number.isNaN(fromFormField('shipping.extra_days', form({ 'shipping.extra_days': 'abc' }))));
  assert.ok(Number.isNaN(fromFormField('shipping.extra_days', form({ 'shipping.extra_days': '' }))));
  assert.equal(fromFormField('shipping.free_enabled', form({})), false);
  assert.equal(fromFormField('shipping.free_enabled', form({ 'shipping.free_enabled': '1' })), true);
  assert.deepEqual(
    fromFormField(
      'orders.auto_place_hours',
      form({ 'orders.auto_place_hours.from': '9:00', 'orders.auto_place_hours.to': '۲۱:۳۰' }),
    ),
    { from: '09:00', to: '21:30' },
  );
});

// ── shipping form ──
test('delivery range: both numbers or none, whole days, max not below min', () => {
  assert.deepEqual(parseRange('', '', 'x'), { ok: true, value: null });
  assert.deepEqual(parseRange('۳', '6', 'x'), { ok: true, value: { min: 3, max: 6 } });
  assert.equal(parseRange('3', '', 'x').ok, false);
  assert.equal(parseRange('6', '3', 'x').ok, false);
  assert.equal(parseRange('a', '3', 'x').ok, false);
  assert.equal(parseRange('1', '61', 'x').ok, false);
  assert.equal(parseRange('-1', '3', 'x').ok, false);
  assert.equal(parseRange('1.5', '3', 'x').ok, false);
});

const names = new Map([
  [1, 'تهران'],
  [2, 'البرز'],
  [3, 'فارس'],
]);

test('shipping form: per-province ranges and the fallback', () => {
  const r = parseShippingForm(
    form({
      label: ' پست ',
      active: '1',
      'fallback.min': '3',
      'fallback.max': '6',
      'p.1.min': '1',
      'p.1.max': '2',
      'p.2.min': '',
      'p.2.max': '',
    }),
    names,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.label, 'پست');
  assert.equal(r.value.active, true);
  assert.deepEqual(r.value.fallback, { min: 3, max: 6 });
  assert.deepEqual(r.value.provinces.find((p) => p.id === 1)?.range, { min: 1, max: 2 });
  assert.equal(r.value.provinces.find((p) => p.id === 2)?.range, null);
  assert.equal(r.value.provinces.length, 3); // only the provinces the server listed
});

test('shipping form: bulk applies to the ticked provinces only; nothing ticked is an error', () => {
  const base = {
    label: 'پست',
    'fallback.min': '',
    'fallback.max': '',
    'p.1.min': '1',
    'p.1.max': '2',
    'p.3.min': '4',
    'p.3.max': '5',
  };
  const r = parseShippingForm(
    form({ ...base, intent: 'bulk', 'bulk.min': '2', 'bulk.max': '4', sel: ['2', '3'] }),
    names,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  const range = (id: number) => r.value.provinces.find((p) => p.id === id)?.range;
  assert.deepEqual(range(1), { min: 1, max: 2 }); // not ticked: its own row
  assert.deepEqual(range(2), { min: 2, max: 4 });
  assert.deepEqual(range(3), { min: 2, max: 4 }); // ticked: the bulk wins over its row
  assert.equal(
    parseShippingForm(form({ ...base, intent: 'bulk', 'bulk.min': '2', 'bulk.max': '4' }), names).ok,
    false,
  );
  assert.equal(
    parseShippingForm(form({ ...base, intent: 'bulk', 'bulk.min': '', 'bulk.max': '', sel: '1' }), names).ok,
    true,
  ); // bulk "clear"
});

test('shipping form: a bad row or label rejects everything, naming the province', () => {
  const bad = parseShippingForm(form({ label: 'پست', 'p.1.min': '5', 'p.1.max': '2' }), names);
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.error : '', /تهران/);
  assert.equal(parseShippingForm(form({ label: 'ا' }), names).ok, false);
  // a province id the server did not list is never read from the form
  const r = parseShippingForm(form({ label: 'پست', 'p.99.min': '1', 'p.99.max': '2' }), names);
  assert.ok(r.ok && !r.value.provinces.some((p) => p.id === 99));
});
