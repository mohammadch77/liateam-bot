// Payment connected to the order flow (step D), end to end with the dev simulator gateway and a stand-in bot (_responder.mjs):
// pay → gateway → callback → paid → the bot's order → placed (or waiting, or needs_review); cancel and try again; a refreshed
// or doubled callback; the wallet; an amount tampered with in the query; the commissions of a three-person chain; SMS events;
// cancel / sent mirrored from the bot. Orders are seeded straight into the database (a review job and a pending order), the
// pay-and-return steps go through the real pages. Invented numbers, new for every run; nothing leaves this machine.
import {
  BASE,
  SCHEMA as S,
  check,
  chromium,
  finish,
  requireLocalApp,
  signIn,
  sleep,
  sql,
  toLatin,
} from './_harness.mjs';
import { startResponder } from './_responder.mjs';
import { chooseAtGateway, enablePayment, setSetting } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const PHONES = `select phone from ${S}.users where phone like '09993%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const num = (t) => Number(toLatin(t));

if (Number(sql(`select count(*) from ${S}.commission_rules`)) > 0) {
  console.error(
    'commission_rules is not empty in the local database; this test replaces its rows. Empty it first.',
  );
  process.exit(2);
}
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where order_id in (${OIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.affiliate_referrals where buyer_user_id in (${UIDS});
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});
    delete from ${S}.commission_rules;`);

const { makeUser } = seeder('09993', stamp);

const orderRow = (n) =>
  sql(
    `select status || '|' || coalesce(bot_order_id::text, '') || '|' || payment_method from ${S}.orders where number = '${n}'`,
  ).split('|');
const events = (n) =>
  sql(
    `select coalesce(string_agg(kind, ',' order by id), '') from ${S}.order_events where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const payments = (n) =>
  sql(
    `select coalesce(string_agg(method || ':' || status || ':' || amount, ',' order by id), '') from ${S}.payments where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const confirmed = (n) =>
  Number(
    sql(
      `select count(*) from ${S}.payments where status = 'confirmed' and order_id = (select id from ${S}.orders where number = '${n}')`,
    ),
  );
const commissions = (n) =>
  sql(
    `select coalesce(string_agg(level || ':' || amount || ':' || status || ':' || hold_days, ',' order by level), '') from ${S}.commissions where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const smsFor = (p, purpose) =>
  Number(
    sql(
      `select count(*) from ${S}.sms_log where phone = '${p}' and purpose = '${purpose}' and status = 'sent'`,
    ),
  );
const floor = (x, pct) => Math.floor((x * pct) / 100);

/** look at the order page until the database says the order is in `status` (each look carries it a step further) */
async function lookUntil(page, number, status, ms = 25000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.goto(`${BASE}/account/orders/${number}`, { waitUntil: 'load' });
    if (orderRow(number)[0] === status) return true;
    await sleep(700);
  }
  return false;
}

const bot = startResponder();
const restorePay = await enablePayment({
  'orders.auto_place_enabled': true,
  'orders.auto_place_hours': { from: '00:00', to: '00:00' }, // 24 hours
  'orders.price_tolerance_toman': 10,
  'sms.provider': 'dev',
  'sms.event.order_placed.enabled': true,
  'sms.event.order_placed.template': 'placed-t',
  'sms.event.payment_ok.enabled': true,
  'sms.event.payment_ok.template': 'pay-ok',
  'sms.event.needs_review.enabled': true,
  'sms.event.needs_review.template': 'review-t',
  'sms.event.shipped.enabled': true,
  'sms.event.shipped.template': 'shipped-t',
  'sms.event.canceled.enabled': true,
  'sms.event.canceled.template': 'cancel-t',
});
const browser = await chromium.launch();
const open = async (user) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, user.phone);
  return { ctx, page };
};
const payNow = async (page, method) => {
  if (method) await page.locator(`[data-pay-option="${method}"] input`).check();
  await page.locator('[data-pay-submit]').click();
};

try {
  wipe();
  const buyer = makeUser(1);
  const ref1 = makeUser(2);
  const ref2 = makeUser(3);
  const other = makeUser(4);
  sql(
    `insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${buyer.id}, ${ref1.id}, 'refa${stamp}'), (${ref1.id}, ${ref2.id}, 'refb${stamp}')`,
  );
  sql(
    `insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active) values ('l1', 'percent', 5, 'all', 1, 7, true), ('l2', 'percent', 2, 'all', 2, 0, true)`,
  );
  const { page } = await open(buyer);

  // ── 1. a purchase through the gateway ──
  const o1 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o1.number}`);
  check(
    '1a the pending order page offers «پرداخت» with the online method',
    (await page.locator('[data-pay-submit]').innerText()).includes('پرداخت') &&
      (await page.locator('[data-pay-option="gateway"] input').isEnabled()),
  );
  await payNow(page);
  await chooseAtGateway(page, 'success'); // (the simulator page showed the order's amount from the database)
  check(
    '1b back at the callback page: paid',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'paid',
  );
  check(
    "1c one confirmed payment of exactly the order's total; the order is paid (no longer pending)",
    confirmed(o1.number) === 1 &&
      payments(o1.number) === `gateway:confirmed:${o1.payable}` &&
      orderRow(o1.number)[0] !== 'pending_payment',
    payments(o1.number),
  );
  check(
    '1d the order was handed to the bot (a bot order is linked) at once',
    orderRow(o1.number)[1] !== '',
    orderRow(o1.number).join(' '),
  );
  const placedOk = await lookUntil(page, o1.number, 'awaiting_payment');
  check(
    '1f automatic placing is on, inside the hours: the bot placed it (awaiting_payment) and the shop followed',
    placedOk,
    orderRow(o1.number)[0],
  );
  const ev1 = events(o1.number);
  check(
    "1g the order's timeline: started, paid, bot create, linked, place, status",
    ['payment_started', 'paid', 'bot_create_requested', 'bot_linked', 'place_requested', 'status'].every(
      (k) => ev1.includes(k),
    ),
    ev1,
  );
  const placed = bot.answered.find((a) => a.kind === 'place');
  check(
    "1h the place job carries Liateam's expected total and the tolerance setting",
    placed?.expected === o1.liveTotal && placed?.maxDiff === 10,
    JSON.stringify(placed),
  );
  check(
    '1i commissions: ONE level only (task K): level 1 = 5% of the goods (rounded down), pending, with its hold; an older data chain (the referrer was referred too) and the level-2 rule earn nothing',
    commissions(o1.number) === `1:${floor(o1.itemsTotal, 5)}:pending:7`,
    commissions(o1.number),
  );
  check(
    '1j no wallet movement for a gateway payment',
    Number(sql(`select count(*) from ${S}.wallet_ledger where order_id = ${o1.id}`)) === 0,
  );
  check(
    '1k SMS events: payment_ok and order_placed were sent (once each), logged as «order»',
    smsFor(buyer.phone, 'order') === 2 && ev1.includes('sms_payment_ok') && ev1.includes('sms_order_placed'),
    String(smsFor(buyer.phone, 'order')),
  );
  check(
    '1l the buyer is not paid a commission himself and nobody outside the chain is',
    Number(
      sql(
        `select count(*) from ${S}.commissions where order_id = ${o1.id} and affiliate_user_id in (${buyer.id}, ${other.id})`,
      ),
    ) === 0,
  );

  // ── 2. a refreshed or doubled callback changes nothing ──
  const o2 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o2.number}`);
  await payNow(page);
  await page.waitForURL(/\/payment\/simulator/);
  const authority = new URL(page.url()).searchParams.get('Authority');
  const okUrl = `${BASE}/payment/callback?Authority=${authority}&Status=OK&sim=success`;
  const bodies = await page.evaluate(
    async (url) =>
      Promise.all(
        [
          fetch(url, { credentials: 'include' }),
          fetch(url, { credentials: 'include' }),
          fetch(url, { credentials: 'include' }),
        ].map((p) => p.then((r) => r.text())),
      ),
    okUrl,
  );
  check(
    '2a three callbacks at the same moment: all see «paid»',
    bodies.every((b) => b.includes('data-callback-result="paid"')),
  );
  check(
    '2b … but the money is counted once: one confirmed payment, one «paid» event, one commission',
    confirmed(o2.number) === 1 &&
      (events(o2.number).match(/\bpaid\b/g) ?? []).length === 1 &&
      commissions(o2.number).split(',').length === 1,
    `${payments(o2.number)} | ${events(o2.number)}`,
  );
  const smsBefore = smsFor(buyer.phone, 'order');
  const commBefore = commissions(o2.number);
  for (let i = 0; i < 2; i++) await page.goto(okUrl);
  await page.reload();
  check(
    '2c refreshing the callback page: still paid, marked as a repeat, nothing done again',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-repeat')) === 'true' &&
      confirmed(o2.number) === 1 &&
      commissions(o2.number) === commBefore,
  );
  await lookUntil(page, o2.number, 'awaiting_payment');
  check(
    '2d no second SMS for the same event, no second bot order',
    smsFor(buyer.phone, 'order') - smsBefore <= 1 &&
      Number(
        sql(`select count(*) from ${S}.order_events where kind = 'bot_linked' and order_id = ${o2.id}`),
      ) === 1,
  );

  // ── 3. cancel, then try again; a failed payment is final ──
  const o3 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o3.number}`);
  await payNow(page);
  await chooseAtGateway(page, 'canceled');
  check(
    '3a backing out: «انصراف» message, the order stays pending_payment',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'canceled' &&
      orderRow(o3.number)[0] === 'pending_payment',
  );
  check(
    '3b the attempt is recorded as failed (canceled); nothing confirmed; no commission, no bot order',
    payments(o3.number) === `gateway:failed:${o3.payable}` &&
      commissions(o3.number) === '' &&
      orderRow(o3.number)[1] === '',
  );
  check(
    '3c a «تلاش دوباره» button is there',
    (await page.locator('[data-pay-submit]').innerText()).includes('تلاش دوباره'),
  );
  const canceledUrl = page.url();
  await page.goto(canceledUrl);
  check(
    '3d refreshing the cancelled return shows the same thing',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'canceled',
  );
  await payNow(page);
  await chooseAtGateway(page, 'failed');
  check(
    '3e a refused payment: «ناموفق», still pending',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'failed' &&
      orderRow(o3.number)[0] === 'pending_payment',
  );
  const failedAuthority = new URL(page.url()).searchParams.get('Authority');
  await page.goto(`${BASE}/payment/callback?Authority=${failedAuthority}&Status=OK&sim=success`);
  check(
    '3f a forged «success» on an attempt that already failed does nothing',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'failed' &&
      confirmed(o3.number) === 0 &&
      orderRow(o3.number)[0] === 'pending_payment',
  );
  await page.locator('[data-pay-submit]').click();
  await chooseAtGateway(page, 'success');
  check(
    '3g trying again and paying works: paid, with two attempts on record (failed, failed, confirmed)',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'paid' &&
      confirmed(o3.number) === 1 &&
      payments(o3.number).split(',').length === 3,
    payments(o3.number),
  );

  // ── 4. the amount is the database's, whatever the query says; another user's return is refused ──
  const o4 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o4.number}`);
  await payNow(page);
  await page.waitForURL(/\/payment\/simulator/);
  const a4 = new URL(page.url()).searchParams.get('Authority');
  check(
    "4a the simulator shows the order's total from the database",
    num(await page.locator('[data-sim-amount]').innerText()) === o4.payable,
  );
  const intruder = await open(other);
  await intruder.page.goto(`${BASE}/payment/callback?Authority=${a4}&Status=OK&sim=success`);
  check(
    '4b another user opening this return gets «unknown» and nothing changes',
    (await intruder.page.locator('[data-callback-result]').getAttribute('data-callback-result')) ===
      'unknown' && confirmed(o4.number) === 0,
  );
  const sim404 = await intruder.page.goto(`${BASE}/payment/simulator?Authority=${a4}`);
  check("4c nor can he open the simulator page of another user's attempt", sim404.status() === 404);
  await page.goto(
    `${BASE}/payment/callback?Authority=${a4}&Status=OK&sim=success&amount=1&total_payable=1&order=AV-100001&paid=1`,
  );
  check(
    '4d an amount and an order number added to the address are ignored: paid for the saved total',
    confirmed(o4.number) === 1 && payments(o4.number) === `gateway:confirmed:${o4.payable}`,
  );
  await page.goto(`${BASE}/payment/callback?Authority=nonsense123&Status=OK`);
  check(
    '4e an unknown authority is «unknown»',
    (await page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'unknown',
  );
  await intruder.ctx.close();

  // ── 5. the wallet ──
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${buyer.id}, 'topup', 5000000, 0, 'seed-topup-${stamp}')`,
  );
  const o5 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o5.number}`);
  check(
    '5a with enough money the wallet is offered with its balance',
    (await page.locator('[data-pay-option="wallet"] input').isEnabled()) &&
      (await page.locator('[data-pay-option="wallet"]').innerText()).includes('موجودی'),
  );
  const balanceBefore = Number(
    sql(`select balance_after from ${S}.wallet_ledger where user_id = ${buyer.id} order by id desc limit 1`),
  );
  await page.locator('[data-pay-option="wallet"] input').check();
  await page.locator('[data-pay-submit]').dblclick(); // a double click
  await page.waitForURL(/\/account\/orders\/AV-\d+\?paid=1/, { timeout: 30000 });
  await sleep(1500);
  check(
    '5b paid from the wallet: one ledger row of minus the total, the balance dropped once',
    Number(
      sql(`select count(*) from ${S}.wallet_ledger where order_id = ${o5.id} and kind = 'order_payment'`),
    ) === 1 &&
      Number(
        sql(
          `select balance_after from ${S}.wallet_ledger where user_id = ${buyer.id} order by id desc limit 1`,
        ),
      ) ===
        balanceBefore - o5.payable,
    `${balanceBefore} - ${o5.payable}`,
  );
  check(
    '5c the order is paid by the wallet payment, once, and goes the same way after payment (bot order, commissions)',
    payments(o5.number) === `wallet:confirmed:${o5.payable}` &&
      orderRow(o5.number)[2] === 'wallet' &&
      commissions(o5.number).split(',').length === 1 &&
      orderRow(o5.number)[1] !== '',
    payments(o5.number),
  );
  await page.reload();
  check(
    '5d reloading the order page after a wallet payment changes nothing',
    Number(sql(`select count(*) from ${S}.wallet_ledger where order_id = ${o5.id}`)) === 1 &&
      confirmed(o5.number) === 1,
  );
  const poor = makeUser(5);
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${poor.id}, 'topup', 1000, 0, 'seed-topup-poor-${stamp}')`,
  );
  const o6 = seedOrder(poor);
  const p2 = await open(poor);
  await p2.page.goto(`${BASE}/account/orders/${o6.number}`);
  check(
    '5e a balance that does not cover the order: the wallet option is disabled and says so',
    !(await p2.page.locator('[data-pay-option="wallet"] input').isEnabled()) &&
      (await p2.page.locator('[data-pay-option="wallet"]').innerText()).includes('کافی نیست'),
  );
  await p2.ctx.close();

  // ── 6. online payment switched off ──
  await setSetting('payment.enabled', false);
  const o7 = seedOrder(ref1);
  const p3 = await open(ref1);
  await p3.page.goto(`${BASE}/account/orders/${o7.number}`);
  check(
    '6a online payment off and no wallet money: the method says unavailable and the button is off',
    (await p3.page.locator('[data-pay-unavailable]').count()) === 1 &&
      (await p3.page.locator('[data-pay-submit]').isDisabled()),
  );
  await setSetting('payment.enabled', true);
  await p3.ctx.close();

  // ── 7. needs_review keeps the money and moves nothing ──
  bot.mode.place = 'needs_review';
  const o8 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o8.number}`);
  await payNow(page, 'gateway');
  await chooseAtGateway(page, 'success');
  const nr = await lookUntil(page, o8.number, 'needs_review');
  check('7a the bot stopped the order: the shop shows needs_review', nr, orderRow(o8.number)[0]);
  check(
    '7b the money stays: payment confirmed, no refund, no wallet row',
    confirmed(o8.number) === 1 &&
      Number(sql(`select count(*) from ${S}.wallet_ledger where order_id = ${o8.id}`)) === 0 &&
      Number(sql(`select refunded_total from ${S}.orders where id = ${o8.id}`)) === 0,
  );
  check(
    '7c the customer is told it is being reviewed; an SMS «needs_review» went out',
    (await page.locator('main').innerText()).includes('در حال بررسی') &&
      smsFor(buyer.phone, 'order') >= 4 &&
      events(o8.number).includes('sms_needs_review'),
  );
  bot.mode.place = 'placed';

  // ── 8. automatic placing off, or outside the hours: the order waits in the queue ──
  await setSetting('orders.auto_place_enabled', false);
  const o9 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o9.number}`);
  await payNow(page, 'gateway');
  await chooseAtGateway(page, 'success');
  await page.goto(`${BASE}/account/orders/${o9.number}`);
  await sleep(2500);
  await page.goto(`${BASE}/account/orders/${o9.number}`);
  const placeJobs = () =>
    Number(
      sql(
        `select count(*) from public.order_jobs where kind = 'place' and (payload->>'order_id')::int = ${Number(orderRow(o9.number)[1] || 0)}`,
      ),
    );
  check(
    '8a automatic placing off: bot order created, but not placed; the order waits (queued) with a note',
    orderRow(o9.number)[0] === 'queued' &&
      orderRow(o9.number)[1] !== '' &&
      events(o9.number).includes('waiting_for_placement') &&
      placeJobs() === 0,
    `${orderRow(o9.number).join(' ')} ${events(o9.number)}`,
  );
  const tehran = new Date(Date.now() + 3.5 * 3600_000);
  const hhmm = (d, plus) => {
    const t = new Date(d.getTime() + plus * 60_000);
    return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  };
  await setSetting('orders.auto_place_enabled', true);
  await setSetting('orders.auto_place_hours', { from: hhmm(tehran, 120), to: hhmm(tehran, 121) });
  const o10 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o10.number}`);
  await payNow(page, 'gateway');
  await chooseAtGateway(page, 'success');
  await page.goto(`${BASE}/account/orders/${o10.number}`);
  await sleep(1500);
  await page.goto(`${BASE}/account/orders/${o10.number}`);
  check(
    '8b outside the working hours: it waits too (reason «wait_hours»)',
    orderRow(o10.number)[0] === 'queued' &&
      sql(
        `select data->>'reason' from ${S}.order_events where kind = 'waiting_for_placement' and order_id = ${o10.id}`,
      ) === 'wait_hours',
  );
  await setSetting('orders.auto_place_hours', { from: '00:00', to: '00:00' });
  check(
    '8c back inside the hours (or 24 h): the next look places it',
    (await lookUntil(page, o10.number, 'awaiting_payment')) && events(o10.number).includes('place_requested'),
  );
  check(
    '8d the order that waited for the operator (8a) was never placed on its own',
    placeJobs() === 0 && orderRow(o9.number)[0] === 'queued',
  );

  // ── 9. the bot's cancel and sent are mirrored; commissions follow ──
  const botOf1 = Number(orderRow(o1.number)[1]);
  sql(`update public.shop_orders set status = 'canceled' where id = ${botOf1}`);
  await lookUntil(page, o1.number, 'canceled', 10000);
  check(
    '9a the bot cancelled it: the shop order is cancelled, its pending commissions are cancelled with amount kept for the record',
    orderRow(o1.number)[0] === 'canceled' &&
      commissions(o1.number)
        .split(',')
        .every((c) => c.includes(':cancelled:')),
    commissions(o1.number),
  );
  check('9b an SMS «canceled» went out once', events(o1.number).includes('sms_canceled'));
  const botOf2 = Number(orderRow(o2.number)[1]);
  sql(
    `update public.shop_orders set status = 'sent', sent_at = now() - interval '1 day', tracking = '{"code": "R-777"}'::jsonb where id = ${botOf2}`,
  );
  await lookUntil(page, o2.number, 'sent', 10000);
  check(
    '9c sent: the shop order follows through the legal steps; each pending commission gets sent_at + its hold as release date',
    orderRow(o2.number)[0] === 'sent' &&
      Number(
        sql(
          `select count(*) from ${S}.commissions where order_id = ${o2.id} and release_at is not null and abs(extract(epoch from release_at - ((select sent_at from ${S}.orders where id = ${o2.id}) + hold_days * interval '1 day'))) < 0.01`,
        ),
      ) === 1,
    commissions(o2.number),
  );
  check(
    '9d an SMS «shipped» went out (purpose shipping) and the tracking code is kept',
    smsFor(buyer.phone, 'shipping') === 1 &&
      sql(`select tracking->>'code' from ${S}.orders where id = ${o2.id}`) === 'R-777',
  );

  // ── 10. an expired live check cannot be paid ──
  const o11 = seedOrder(buyer, { expiresInSec: 60 });
  await page.goto(`${BASE}/account/orders/${o11.number}`);
  await payNow(page, 'gateway');
  await page.waitForURL(/error=/);
  check(
    '10 the check no longer holds: no payment starts, the order is cancelled, the customer is told',
    orderRow(o11.number)[0] === 'canceled' &&
      payments(o11.number) === '' &&
      (await page.locator('[role=alert]').filter({ hasText: /\S/ }).first().innerText()).includes('مهلت'),
  );

  // ── 11. responsive: the three payment pages at 360 – 1920 ──
  const o12 = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o12.number}`);
  await payNow(page, 'gateway');
  await page.waitForURL(/\/payment\/simulator/);
  const simUrl = page.url();
  const cb = `${BASE}/payment/callback?Authority=${new URL(simUrl).searchParams.get('Authority')}&Status=NOK&sim=canceled`;
  const over = [];
  for (const [w, h] of [
    [360, 780],
    [390, 844],
    [768, 1024],
    [1280, 800],
    [1920, 1080],
  ])
    for (const url of [simUrl, cb, `${BASE}/account/orders/${o12.number}`]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url, { waitUntil: 'load' });
      if ((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) > 1)
        over.push(`${new URL(url).pathname}@${w}`);
    }
  check(
    '11 no sideways scroll from 360 to 1920 on the simulator, the callback and the order page',
    over.length === 0,
    over.join(', '),
  );
} finally {
  try {
    await restorePay();
  } catch (e) {
    console.error('restore failed:', e.message);
  }
  await bot.stop();
  wipe();
  await browser.close();
}
finish();
