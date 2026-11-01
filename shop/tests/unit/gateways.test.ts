// Payment gateways and SMS providers: adapters with a FAKE http (no request ever leaves the machine), the toman -> rial
// conversion, timeouts and errors, secrets never in messages, the dev providers refused in production. Run: npm run test:unit
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FetchLike } from '../../src/lib/http/post-json.ts';
import { devGateway } from '../../src/lib/payment/dev.ts';
import { createGateway, PAYMENT_PROVIDERS } from '../../src/lib/payment/registry.ts';
import { PaymentError, tomanToRial } from '../../src/lib/payment/types.ts';
import { zarinpalGateway } from '../../src/lib/payment/zarinpal.ts';
import { devSmsProvider } from '../../src/lib/sms/dev.ts';
import { paramsFor, SMS_EVENTS } from '../../src/lib/sms/events.ts';
import { ippanelProvider, toE164 } from '../../src/lib/sms/ippanel.ts';
import { kavenegarProvider } from '../../src/lib/sms/kavenegar.ts';
import { createSmsProvider, SMS_PROVIDERS } from '../../src/lib/sms/registry.ts';
import { SmsError } from '../../src/lib/sms/types.ts';
import { SETTINGS, validateSetting } from '../../src/lib/settings/registry.ts';

type Call = { url: string; headers: Record<string, string>; body: string };
/** a fake fetch that records every call and answers with `reply` (or throws) */
function fake(reply: unknown | (() => never), status = 200) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (typeof reply === 'function') (reply as () => never)();
    return { status, ok: status < 400, json: async () => reply };
  };
  return { f, calls };
}
const timeout = () => {
  throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
};
const offline = () => {
  throw new TypeError('fetch failed');
};

const MERCHANT = '1344b5d4-0048-11e8-94db-005056a205be';
const SECRET_KEY = 'sk-very-secret-key-123456';

// ── amounts ──
test('amounts are whole toman; rial is toman x 10, only inside an adapter', () => {
  assert.equal(tomanToRial(1), 10);
  assert.equal(tomanToRial(9_824_900), 98_249_000);
  for (const bad of [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, Infinity])
    assert.throws(() => tomanToRial(bad), PaymentError);
});

// ── zarinpal ──
const zp = (f: FetchLike, sandbox = false) => zarinpalGateway({ merchantId: MERCHANT, sandbox, fetch: f });
const req = {
  amount: 125_000,
  orderNo: 'AV-100001',
  callbackUrl: 'https://shop.example.com/payment/callback',
  description: 'سفارش AV-100001',
  mobile: '09121234567',
};

test('zarinpal request: rial amount, merchant id, callback, redirect to StartPay', async () => {
  const { f, calls } = fake({
    data: { code: 100, authority: 'A00000000000000000000000000123456789', message: 'Success' },
    errors: [],
  });
  const r = await zp(f).request(req);
  assert.equal(r.authority, 'A00000000000000000000000000123456789');
  assert.equal(
    r.redirectUrl,
    'https://payment.zarinpal.com/pg/StartPay/A00000000000000000000000000123456789',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://payment.zarinpal.com/pg/v4/payment/request.json');
  const body = JSON.parse(calls[0]!.body);
  assert.equal(body.amount, 1_250_000); // 125,000 toman = 1,250,000 rial
  assert.equal(body.merchant_id, MERCHANT);
  assert.equal(body.callback_url, req.callbackUrl);
  assert.equal(body.metadata.order_id, 'AV-100001');
  assert.equal(body.metadata.mobile, '09121234567');
});

test('zarinpal sandbox uses the sandbox hosts', async () => {
  const { f, calls } = fake({ data: { code: 100, authority: 'AUTH1' }, errors: [] });
  const r = await zp(f, true).request(req);
  assert.match(calls[0]!.url, /^https:\/\/sandbox\.zarinpal\.com\//);
  assert.match(r.redirectUrl, /^https:\/\/sandbox\.zarinpal\.com\/pg\/StartPay\/AUTH1$/);
});

test('zarinpal request errors: refused (with the code), garbage, offline, timeout; no credentials in the message', async () => {
  const refused = fake({ data: [], errors: { code: -9, message: 'validation error' } });
  await assert.rejects(
    zp(refused.f).request(req),
    (e: PaymentError) => e.reason === 'rejected' && e.code === -9,
  );
  await assert.rejects(zp(fake('<html>').f).request(req), (e: PaymentError) => e.reason === 'bad_response');
  await assert.rejects(zp(fake(null).f).request(req), (e: PaymentError) => e.reason === 'bad_response');
  await assert.rejects(zp(fake(offline).f).request(req), (e: PaymentError) => e.reason === 'unreachable');
  await assert.rejects(
    zp(fake(timeout).f).request(req),
    (e: PaymentError) => e.reason === 'timeout' && !e.message.includes(MERCHANT),
  );
  await assert.rejects(
    zp(fake({}).f).request({ ...req, amount: 0 }),
    (e: PaymentError) => e.reason === 'invalid_amount',
  );
});

test('zarinpal verify: 100 and 101 are paid; the amount is asked in rial; a cancelled return asks nothing', async () => {
  const ok = fake({ data: { code: 100, ref_id: 201, card_pan: '603799******1234', fee: 0 }, errors: [] });
  const v = await zp(ok.f).verify({
    authority: 'AUTH1',
    amount: 125_000,
    query: { Authority: 'AUTH1', Status: 'OK' },
  });
  assert.deepEqual([v.ok, v.outcome, v.refId, v.cardMasked], [true, 'paid', '201', '603799******1234']);
  assert.deepEqual(JSON.parse(ok.calls[0]!.body), {
    merchant_id: MERCHANT,
    amount: 1_250_000,
    authority: 'AUTH1',
  });
  assert.equal(ok.calls[0]!.url, 'https://payment.zarinpal.com/pg/v4/payment/verify.json');

  const again = fake({ data: { code: 101, ref_id: 201 }, errors: [] });
  assert.equal(
    (await zp(again.f).verify({ authority: 'AUTH1', amount: 125_000, query: {} })).outcome,
    'paid',
  );

  const nok = fake({});
  const c = await zp(nok.f).verify({ authority: 'AUTH1', amount: 125_000, query: { Status: 'NOK' } });
  assert.deepEqual([c.ok, c.outcome, nok.calls.length], [false, 'canceled', 0]);
});

test('zarinpal verify: refused, offline and timeout are results (never thrown), and never claim paid', async () => {
  const refused = await zp(fake({ data: [], errors: { code: -50, message: 'amount mismatch' } }).f).verify({
    authority: 'A',
    amount: 1000,
    query: {},
  });
  assert.deepEqual([refused.ok, refused.outcome, refused.raw.code], [false, 'failed', -50]);
  for (const fail of [offline, timeout]) {
    const r = await zp(fake(fail).f).verify({ authority: 'A', amount: 1000, query: {} });
    assert.deepEqual([r.ok, r.outcome], [false, 'error']);
    assert.ok(!JSON.stringify(r.raw).includes(MERCHANT));
  }
});

test('zarinpal self check: format only, no network', () => {
  const never = fake({}, 500);
  assert.equal(zarinpalGateway({ merchantId: MERCHANT, sandbox: true, fetch: never.f }).selfCheck().ok, true);
  assert.equal(zarinpalGateway({ merchantId: 'abc', sandbox: true, fetch: never.f }).selfCheck().ok, false);
  assert.equal(zarinpalGateway({ merchantId: '', sandbox: true, fetch: never.f }).selfCheck().ok, false);
  assert.equal(never.calls.length, 0);
});

// ── dev gateway + registry ──
test('the dev gateway simulates paid / failed / canceled without a network', async () => {
  const cfg = { merchantId: '', sandbox: true };
  const ok = devGateway(cfg, 'success');
  const started = await ok.request(req);
  assert.match(started.redirectUrl, /Status=OK/);
  const paid = await ok.verify({
    authority: started.authority,
    amount: 1000,
    query: { sim: 'success', Status: 'OK' },
  });
  assert.deepEqual([paid.ok, paid.outcome], [true, 'paid']);
  assert.equal(
    (await devGateway(cfg, 'failed').verify({ authority: 'X', amount: 1, query: { sim: 'failed' } })).outcome,
    'failed',
  );
  assert.equal(
    (await devGateway(cfg, 'canceled').verify({ authority: 'X', amount: 1, query: { Status: 'NOK' } }))
      .outcome,
    'canceled',
  );
  await assert.rejects(ok.request({ ...req, amount: -1 }), PaymentError);
});

test('the dev gateway is refused in production; real ones are allowed; unknown ids throw', () => {
  const cfg = { merchantId: MERCHANT, sandbox: false };
  assert.throws(() => createGateway('dev', cfg, true), /not allowed in production/);
  assert.equal(createGateway('dev', cfg, false).id, 'dev');
  assert.equal(createGateway('zarinpal', cfg, true).id, 'zarinpal');
  assert.throws(() => createGateway('nope' as never, cfg, false), /unknown/);
  assert.equal(PAYMENT_PROVIDERS.zarinpal.verified, false); // never run against the real service
});

// ── sms ──
const MOBILE = '09121234567';

test('kavenegar OTP: form body with receptor, template and token; success returns the message id', async () => {
  const { f, calls } = fake({ return: { status: 200 }, entries: [{ messageid: 8123 }] });
  const r = await kavenegarProvider({ apiKey: SECRET_KEY, otpTemplate: 'login-otp', fetch: f }).sendOtp(
    MOBILE,
    '48213',
  );
  assert.equal(r.providerRef, '8123');
  assert.equal(calls[0]!.url, `https://api.kavenegar.com/v1/${SECRET_KEY}/verify/lookup.json`);
  assert.equal(calls[0]!.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(calls[0]!.body);
  assert.deepEqual(
    [form.get('receptor'), form.get('template'), form.get('token')],
    [MOBILE, 'login-otp', '48213'],
  );
});

test('kavenegar template: the variables go as token, token2, token3 in order', async () => {
  const { f, calls } = fake({ return: { status: 200 }, entries: [] });
  await kavenegarProvider({ apiKey: SECRET_KEY, fetch: f }).sendTemplate(
    MOBILE,
    'shipped',
    paramsFor('shipped', { order_no: 'AV-100001', tracking: '9912', total: 5 }),
  );
  const form = new URLSearchParams(calls[0]!.body);
  assert.deepEqual(
    [form.get('template'), form.get('token'), form.get('token2'), form.get('token3')],
    ['shipped', 'AV-100001', '9912', null],
  );
});

test('kavenegar errors: refused (code), offline, timeout, not configured; the key never appears in a message', async () => {
  const p = (f: FetchLike) => kavenegarProvider({ apiKey: SECRET_KEY, otpTemplate: 't', fetch: f });
  await assert.rejects(
    p(fake({ return: { status: 424 } }).f).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'rejected' && e.code === 424,
  );
  await assert.rejects(p(fake(null, 500).f).sendOtp(MOBILE, '1'), (e: SmsError) => e.reason === 'rejected');
  await assert.rejects(
    p(fake(offline).f).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'unreachable' && !e.message.includes(SECRET_KEY),
  );
  await assert.rejects(
    p(fake(timeout).f).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'timeout' && !e.message.includes(SECRET_KEY),
  );
  const none = fake({});
  await assert.rejects(
    kavenegarProvider({ apiKey: SECRET_KEY, fetch: none.f }).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'misconfigured',
  );
  await assert.rejects(
    kavenegarProvider({ apiKey: '', otpTemplate: 't', fetch: none.f }).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'misconfigured',
  );
  assert.equal(none.calls.length, 0);
});

test('ippanel pattern: E.164 recipient, pattern code, params, token header, the admin-given host', async () => {
  const { f, calls } = fake({
    data: { message_outbox_ids: [77] },
    meta: { status: true, message_code: '200-1' },
  });
  const prov = ippanelProvider({
    apiKey: SECRET_KEY,
    sender: '+983000505',
    otpTemplate: 'otp-pattern',
    endpoint: 'https://api.example-sms.test/',
    fetch: f,
  });
  const r = await prov.sendOtp(MOBILE, '55555');
  assert.equal(r.providerRef, '77');
  assert.equal(toE164(MOBILE), '+989121234567');
  assert.equal(calls[0]!.url, 'https://api.example-sms.test/api/send');
  assert.equal(calls[0]!.headers.Authorization, SECRET_KEY);
  assert.deepEqual(JSON.parse(calls[0]!.body), {
    sending_type: 'pattern',
    from_number: '+983000505',
    code: 'otp-pattern',
    recipients: ['+989121234567'],
    params: { code: '55555' },
  });
});

test('ippanel errors: refused, offline, timeout; missing host / sender / pattern never calls the network', async () => {
  const base = {
    apiKey: SECRET_KEY,
    sender: '3000',
    otpTemplate: 'p',
    endpoint: 'https://api.example-sms.test',
  };
  await assert.rejects(
    ippanelProvider({ ...base, fetch: fake({ data: null, meta: { status: false } }, 400).f }).sendOtp(
      MOBILE,
      '1',
    ),
    (e: SmsError) => e.reason === 'rejected',
  );
  await assert.rejects(
    ippanelProvider({ ...base, fetch: fake(offline).f }).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'unreachable',
  );
  await assert.rejects(
    ippanelProvider({ ...base, fetch: fake(timeout).f }).sendOtp(MOBILE, '1'),
    (e: SmsError) => e.reason === 'timeout' && !e.message.includes(SECRET_KEY),
  );
  const none = fake({});
  for (const missing of [{ endpoint: '' }, { sender: '' }, { otpTemplate: '' }, { apiKey: '' }])
    await assert.rejects(
      ippanelProvider({ ...base, ...missing, fetch: none.f }).sendOtp(MOBILE, '1'),
      (e: SmsError) => e.reason === 'misconfigured',
    );
  assert.equal(none.calls.length, 0);
  assert.equal(SMS_PROVIDERS.ippanel.verified, false);
});

test('the dev sms provider logs a masked number and the code, never the template text, and sends nothing', async () => {
  const lines: Record<string, unknown>[] = [];
  const p = devSmsProvider({ log: (l) => lines.push(l) });
  await p.sendOtp(MOBILE, '12345');
  await p.sendTemplate(MOBILE, 'paid-pattern', paramsFor('payment_ok', { order_no: 'AV-1', total: 100 }));
  assert.equal(lines[0]!.to, '0912•••4567');
  assert.equal(lines[0]!.devCode, '12345');
  assert.ok(!JSON.stringify(lines).includes(MOBILE));
  assert.deepEqual(lines[1]!.vars, ['order_no', 'total']);
  await assert.rejects(p.sendTemplate(MOBILE, '', {}), (e: SmsError) => e.reason === 'misconfigured');
});

test('the dev sms provider is refused in production', () => {
  assert.throws(() => createSmsProvider('dev', { apiKey: '' }, true), /not allowed in production/);
  assert.equal(createSmsProvider('kavenegar', { apiKey: 'k' }, true).id, 'kavenegar');
});

test("event variables: only the event's own, in order, as strings", () => {
  assert.deepEqual(Object.keys(paramsFor('shipped', { order_no: 'AV-1', tracking: 'T9', total: 5 })), [
    'order_no',
    'tracking',
  ]);
  assert.deepEqual(paramsFor('order_placed', { order_no: 'AV-2', total: 1500 }), {
    order_no: 'AV-2',
    total: '1500',
  });
  assert.deepEqual(paramsFor('needs_review', {}), { order_no: '' });
  assert.deepEqual(
    SMS_EVENTS.map((e) => e.key),
    ['order_placed', 'payment_ok', 'needs_review', 'shipped', 'canceled'],
  );
});

// ── settings of these three features ──
test('the registry holds the payment and sms settings, with every event switch off and no commission default', () => {
  assert.ok(!('commission.default_percent' in SETTINGS));
  for (const e of SMS_EVENTS) {
    assert.equal(
      (SETTINGS as Record<string, { default: unknown }>)[`sms.event.${e.key}.enabled`]?.default,
      false,
    );
    assert.equal(
      (SETTINGS as Record<string, { default: unknown }>)[`sms.event.${e.key}.template`]?.default,
      '',
    );
  }
  assert.equal(SETTINGS['payment.enabled'].default, false);
  assert.equal(SETTINGS['payment.sandbox'].default, true);
  assert.equal(SETTINGS['sms.provider'].default, 'env');
  assert.equal(SETTINGS['payment.merchant_id'].kind, 'secret');
  assert.equal(SETTINGS['payment.api_key'].kind, 'secret');
  assert.equal(SETTINGS['sms.api_key'].kind, 'secret');
});

test('validation: providers, template codes, line number and the ippanel host', () => {
  assert.equal(validateSetting('payment.provider', 'zarinpal').ok, true);
  assert.equal(validateSetting('payment.provider', 'paypal').ok, false);
  assert.equal(validateSetting('sms.provider', 'ippanel').ok, true);
  assert.equal(validateSetting('sms.provider', 'twilio').ok, false);
  assert.equal(validateSetting('sms.otp_template', 'login-otp_1').ok, true);
  assert.equal(validateSetting('sms.otp_template', 'bad template!').ok, false);
  assert.equal(validateSetting('sms.event.shipped.template', '').ok, true);
  assert.equal(validateSetting('sms.sender', '3000505').ok, true);
  assert.equal(validateSetting('sms.sender', 'abc').ok, false);
  assert.deepEqual(validateSetting('sms.endpoint', 'https://api.example-sms.test/v1/'), {
    ok: true,
    value: 'https://api.example-sms.test/v1',
  });
  assert.equal(validateSetting('sms.endpoint', 'http://api.example-sms.test').ok, false);
  assert.equal(validateSetting('sms.endpoint', 'https://u:p@api.example-sms.test').ok, false);
});
