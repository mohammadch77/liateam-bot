// The operator's order pages (task J), end to end on the dev simulator gateway and a stand-in bot (_responder.mjs): who may see
// them (a customer: 403; the support role: a read-only page with a masked phone and no buttons; the admin: all), the list (status
// chips, search by number and mobile, dates, sort), a needs_review stop (price down continues and returns the saving once, price up
// and a missing item cannot continue, a new check, cancel with the whole payment back), a customer's cancel request (approved
// → refunded; rejected with a reason → told), the manual placing, the Liateam payment link and its countdown and the reminder
// (once), «paid» and the tracking code up to sent, a stale page or a second tab or two admins at once (one effect), the private
// notes, the audit entries without a phone number. Orders are seeded in the database; invented numbers, new every run.
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
import { makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const CRON = process.env.E2E_CRON_SECRET;
if (!CRON) {
  console.error('set E2E_CRON_SECRET to the CRON_SECRET the app was started with');
  process.exit(2);
}
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09994', stamp);
const PHONES = `select phone from ${S}.users where phone like '09994%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const OPERATOR = `09994${stamp}8`;
const hex = (s) => `convert_from(decode('${Buffer.from(s, 'utf8').toString('hex')}', 'hex'), 'UTF8')`;

if (Number(sql(`select count(*) from ${S}.commission_rules`)) > 0) {
  console.error('commission_rules is not empty in the local database; this test replaces its rows. Empty it first.');
  process.exit(2);
}
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.order_notes where order_id in (${OIDS});
    delete from ${S}.commissions where order_id in (${OIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES}) or phone = '${OPERATOR}';
    delete from ${S}.affiliate_referrals where buyer_user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.addresses where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'order' and entity_id not in (select id::text from ${S}.orders));
    delete from ${S}.users where phone in (${PHONES});
    delete from ${S}.commission_rules;`);

const row = (n) => sql(`select status || '|' || coalesce(bot_order_id::text, '') from ${S}.orders where number = '${n}'`).split('|');
const status = (n) => row(n)[0];
const bid = (n) => row(n)[1];
const events = (n) =>
  sql(`select coalesce(string_agg(kind, ',' order by id), '') from ${S}.order_events where order_id = (select id from ${S}.orders where number = '${n}')`);
const countEvent = (n, kind) => events(n).split(',').filter((k) => k === kind).length;
const balance = (u) => Number(sql(`select coalesce((select balance_after from ${S}.wallet_ledger where user_id = ${u.id} order by id desc limit 1), 0)`));
const ledger = (id, like) => Number(sql(`select count(*) from ${S}.wallet_ledger where order_id = ${id} and idempotency_key like '${like}'`));
const botStatus = (b) => sql(`select status from public.shop_orders where id = ${b}`);
const commissions = (n) =>
  sql(`select coalesce(string_agg(status::text, ','), '') from ${S}.commissions where order_id = (select id from ${S}.orders where number = '${n}')`);
const total = (o) => Number(sql(`select total_payable from ${S}.orders where id = ${o.id}`));
const smsSent = (p, purpose) => Number(sql(`select count(*) from ${S}.sms_log where phone = '${p}' and purpose = '${purpose}' and status = 'sent'`));
const placeJobs = (b) =>
  Number(sql(`select count(*) from public.order_jobs where kind = 'place' and requested_by = 'shop' and (payload->>'order_id')::int = ${b}`));
const topup = (u, amount, key) =>
  sql(`set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${u.id}, 'topup', ${amount}, 0, '${key}-${stamp}')`);
/** a statement on shop tables: the status trigger needs the schema on the search path */
const sh = (q) => sql(`set search_path = ${S}, public; ${q}`);
const tick = () => fetch(`${BASE}/api/internal/tick`, { method: 'POST', headers: { 'x-cron-secret': CRON } }).then((r) => r.json());

const bot = startResponder();
bot.mode.place = 'placed';
const restorePay = await enablePayment({
  'orders.auto_place_enabled': false,
  'sms.provider': 'dev',
  'sms.event.canceled.enabled': true,
  'sms.event.canceled.template': 'cancel-t',
  'sms.event.shipped.enabled': true,
  'sms.event.shipped.template': 'ship-t',
  'sms.event.cancel_rejected.enabled': true,
  'sms.event.cancel_rejected.template': 'rej-t',
  'orders.operator_phone': OPERATOR,
  'sms.operator_template': 'op-t',
  'orders.payment_link_ttl_minutes': 20,
  'orders.payment_link_remind_minutes': 5,
});
const browser = await chromium.launch();
const open = async (user, w = 1280) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, user.phone);
  return { ctx, page };
};

/** a paid, queued order with its bot order, paid from the wallet through the real order page */
async function paidOrder(page, user) {
  const o = seedOrder(user);
  await page.goto(`${BASE}/account/orders/${o.number}`);
  await page.locator('[data-pay-option="wallet"] input').check();
  await page.locator('[data-pay-submit]').click();
  await page.waitForURL(/paid=1/, { timeout: 40000 });
  for (let i = 0; i < 30 && !bid(o.number); i++) await sleep(500);
  return o;
}
/** the order as the bot left it, both rows moved together (the shop follows the bot when someone looks) */
const toAwaiting = (o, minutesAgo = 3) => {
  const b = bid(o.number);
  sql(`update public.shop_orders set status = 'awaiting_payment', payment_url = 'https://pay.example.test/${stamp}${o.id}', liateam_order_code = 'LT${stamp}${o.id}', placed_at = now() - interval '${minutesAgo} minutes' where id = ${b}`);
  sh(`update ${S}.orders set status = 'awaiting_payment' where id = ${o.id}`);
};
const toNeedsReview = (o, { reason = 'price', delta = 0, missing = [] }) => {
  const b = bid(o.number);
  const expected = Number(sql(`select live_total from ${S}.orders where id = ${o.id}`));
  const live = expected + delta;
  sql(`update public.shop_orders set status = 'needs_review', last_error = 'price moved' where id = ${b}`);
  sql(`insert into public.shop_order_events (order_id, kind, message, data) values (${b}, 'needs_review', 'x', '${JSON.stringify({ reason, live_total: live, expected_total: expected, missing })}'::jsonb)`);
  sh(`update ${S}.orders set status = 'needs_review', needs_review_reason = 'price moved' where id = ${o.id}`);
  return { expected, live };
};
const customerRequestsCancel = (o) =>
  sql(`insert into ${S}.order_events (order_id, kind, data) values (${o.id}, 'cancel_requested', '{"status":"awaiting_payment"}'::jsonb)`);

/** presses an operator button on the order's page, fills the dialog, confirms; returns what the panel said */
async function op(page, number, action, value, { reload = true } = {}) {
  if (reload) await page.goto(`${BASE}/admin/orders/${number}`);
  await page.locator(`[data-op="${action}"]`).click();
  const dlg = page.locator('[data-confirm-dialog="operator"][open]');
  await dlg.waitFor();
  if (value !== undefined) await dlg.locator('[data-op-input]').fill(value);
  await dlg.locator('[data-confirm-yes]').click();
  const res = page.locator('[data-operator-result]');
  await res.waitFor({ timeout: 30000 });
  return { ok: (await res.getAttribute('data-operator-result')) === 'ok', text: await res.innerText() };
}
const hasOp = async (page, number, action) => {
  await page.goto(`${BASE}/admin/orders/${number}`);
  return (await page.locator(`[data-op="${action}"]`).count()) === 1;
};
/** the countdown settles after the page hydrates */
const seen = (page, sel) => page.locator(sel).waitFor({ timeout: 8000 }).then(() => true, () => false);
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

try {
  wipe();
  const buyer = makeUser(1);
  const ref1 = makeUser(2);
  const other = makeUser(3);
  const support = makeUser(4);
  sql(`insert into ${S}.user_roles (user_id, role) values (${support.id}, 'support')`);
  sql(`insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${buyer.id}, ${ref1.id}, 'refj${stamp}')`);
  sql(`insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active) values ('l1', 'percent', 5, 'all', 1, 7, true)`);
  sql(`update ${S}.users set full_name = ${hex('خریدار آزمون')} where id = ${buyer.id}`);
  topup(buyer, 200_000_000, 'topup-j');
  const { page: bp } = await open(buyer);

  // the orders, each in the state its scenario needs
  const oQ = await paidOrder(bp, buyer); // queued: manual place
  const oC = await paidOrder(bp, buyer); // queued: two admins cancel at once
  const oR = await paidOrder(bp, buyer); // needs_review, price down
  const oU = await paidOrder(bp, buyer); // needs_review, price up
  const oX = await paidOrder(bp, buyer); // needs_review, an item missing
  const oA = await paidOrder(bp, buyer); // awaiting payment + a cancel request, approved
  const oB = await paidOrder(bp, buyer); // awaiting payment + a cancel request, rejected
  const oL = await paidOrder(bp, buyer); // awaiting payment: the link, paid, sent
  const oD = await paidOrder(bp, buyer); // a stale page
  check('0 seven paid orders are queued with their bot orders', [oQ, oC, oR, oU, oX, oA, oB, oL, oD].every((o) => status(o.number) === 'queued' && bid(o.number) !== ''));
  const nr = toNeedsReview(oR, { delta: -100_000 });
  toNeedsReview(oU, { delta: 100_000 });
  toNeedsReview(oX, { reason: 'unavailable', delta: -50_000, missing: [541] });
  toAwaiting(oA);
  customerRequestsCancel(oA);
  toAwaiting(oB);
  customerRequestsCancel(oB);
  toAwaiting(oL, 3);
  toAwaiting(oD);

  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  sql(`update ${S}.users set full_name = ${hex('مدیر آزمون')} where phone = '${adminPhone}'`);
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await actx.newPage();
  await adminSignIn(ap, adminPhone, '/admin/orders');

  // ── 1. who may see what ──
  const oc = await open(other);
  const r1 = await oc.page.goto(`${BASE}/admin/orders`);
  const r2 = await oc.page.goto(`${BASE}/admin/orders/${oL.number}`);
  check('1a a customer gets 403 on the list and on an order', r1?.status() === 403 && r2?.status() === 403);
  const sp = await open(support);
  await sp.page.goto(`${BASE}/admin/orders/${oL.number}`);
  const supPhone = await sp.page.locator('[data-phone]').innerText();
  check(
    '1b the support role sees the order, with a masked phone, no buttons, no payment link, no private notes',
    (await sp.page.locator('[data-order-detail]').count()) === 1 &&
      supPhone.includes('•••') &&
      !toLatin(supPhone).includes(buyer.phone) &&
      (await sp.page.locator('[data-operator-panel]').count()) === 0 &&
      (await sp.page.locator('[data-payment-url]').count()) === 0 &&
      (await sp.page.locator('[data-notes]').count()) === 0,
  );
  const r3 = await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  const adminPhoneShown = toLatin(await ap.locator('[data-phone]').innerText());
  check(
    '1c the admin sees the whole phone, the address, the payment link and the buttons',
    r3?.status() === 200 && adminPhoneShown === buyer.phone && (await ap.locator('[data-payment-url]').count()) === 1 && (await ap.locator('[data-op]').count()) > 0,
  );
  check('1d an unknown number and a malformed one are 404', (await ap.goto(`${BASE}/admin/orders/AV-999999999`))?.status() === 404 && (await ap.goto(`${BASE}/admin/orders/zzz`))?.status() === 404);
  await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  const body = await ap.locator('body').innerText();
  check('1e no purchase price or profit anywhere on the page', !/cost|profit|سود|قیمت خرید/i.test(body));

  // ── 2. the list ──
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}`);
  check('2a searching by mobile finds all nine orders, the phone masked in the rows', (await ap.locator('[data-order-row]').count()) === 9 && !(await ap.locator('[data-orders-list]').innerText()).includes(buyer.phone));
  await ap.goto(`${BASE}/admin/orders?q=${oL.number}`);
  check('2b searching by order number finds that one', (await ap.locator('[data-order-row]').count()) === 1 && (await ap.locator(`[data-order-row="${oL.number}"]`).count()) === 1);
  await ap.goto(`${BASE}/admin/orders?q=${encodeURIComponent("x' or 1=1 --")}`);
  check('2c a search that is not a number finds nothing (and breaks nothing)', (await ap.locator('[data-order-row]').count()) === 0);
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&status=needs_review`);
  check('2d the needs_review chip: the three stopped orders', (await ap.locator('[data-order-row]').count()) === 3);
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&status=awaiting_payment`);
  check('2e the awaiting-payment chip: four orders', (await ap.locator('[data-order-row]').count()) === 4);
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&status=action`);
  check('2f «نیازمند اقدام»: stopped + awaiting + waiting for the operator (queued orders wait for it too)', (await ap.locator('[data-order-row][data-needs-action="true"]').count()) === 9);
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&from=${day(2)}`);
  const none = await ap.locator('[data-order-row]').count();
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&from=${day(-1)}&to=${day(1)}`);
  check('2g a date range: after today finds none, around today finds all', none === 0 && (await ap.locator('[data-order-row]').count()) === 9);
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&sort=total_desc`);
  const shown = await ap.locator('[data-order-link]').allInnerTexts();
  const wanted = sql(`select string_agg(number, ',' order by total_payable desc, id desc) from ${S}.orders where user_id = ${buyer.id}`).split(',');
  check('2h sorted by the highest total', shown.map((t) => t.trim()).join(',') === wanted.join(','));
  await ap.goto(`${BASE}/admin/orders?q=${buyer.phone}&sort=bogus&status=bogus&page=-5&from=nope`);
  check('2i junk in the query falls back to the defaults', (await ap.locator('[data-order-row]').count()) === 9);

  // ── 3. a manual placing ──
  check('3a a queued order offers «ثبت در لیاتیم»', await hasOp(ap, oQ.number, 'place'));
  const jobsBefore = placeJobs(Number(bid(oQ.number)));
  const p1 = await op(ap, oQ.number, 'place', undefined, { reload: false });
  const job = sql(`select payload->>'expected_total' from public.order_jobs where kind = 'place' and requested_by = 'shop' and (payload->>'order_id')::int = ${bid(oQ.number)} order by id desc limit 1`);
  check('3b it queues ONE place job at the price the customer was shown, with an event', p1.ok && placeJobs(Number(bid(oQ.number))) === jobsBefore + 1 && Number(job) === Number(sql(`select live_total from ${S}.orders where id = ${oQ.id}`)) && countEvent(oQ.number, 'place_requested') === 1);
  await ap.goto(`${BASE}/admin/orders/${oQ.number}`);
  let again = { ok: true };
  if ((await ap.locator('[data-op="place"]').count()) === 1) again = await op(ap, oQ.number, 'place', undefined, { reload: false });
  check('3c pressing it again does not queue a second job', !again.ok && placeJobs(Number(bid(oQ.number))) === jobsBefore + 1);

  // ── 4. needs_review ──
  await ap.goto(`${BASE}/admin/orders/${oR.number}`);
  check(
    '4a price down: the reason, both totals and the verdict are shown; continue, re-check and cancel are offered',
    (await ap.locator('[data-review-why]').innerText()).includes('price moved') &&
      (await ap.locator('[data-review-kind="price_down"]').count()) === 1 &&
      (await ap.locator('[data-op="continue_review"]').count()) === 1 &&
      (await ap.locator('[data-op="recheck"]').count()) === 1 &&
      (await ap.locator('[data-op="cancel"]').count()) === 1,
  );
  const balR = balance(buyer);
  const c1 = await op(ap, oR.number, 'continue_review', undefined, { reload: false });
  check(
    '4b continuing places at the new total and returns the saving to the wallet ONCE (own ledger key), with an event',
    c1.ok && Number(sql(`select payload->>'expected_total' from public.order_jobs where kind = 'place' and requested_by = 'shop' and (payload->>'order_id')::int = ${bid(oR.number)} order by id desc limit 1`)) === nr.live && balance(buyer) === balR + 100_000 && ledger(oR.id, 'review-diff:%') === 1 && countEvent(oR.number, 'review_continued') === 1,
  );
  await ap.goto(`${BASE}/admin/orders/${oR.number}`);
  let c2 = { ok: false };
  if ((await ap.locator('[data-op="continue_review"]').count()) === 1) c2 = await op(ap, oR.number, 'continue_review', undefined, { reload: false });
  check('4c continuing again refunds nothing more', !c2.ok && ledger(oR.id, 'review-diff:%') === 1 && balance(buyer) === balR + 100_000);

  await ap.goto(`${BASE}/admin/orders/${oU.number}`);
  check(
    '4d price up: the verdict says it cannot continue; no continue button, but re-check and cancel',
    (await ap.locator('[data-review-kind="price_up"]').count()) === 1 && (await ap.locator('[data-op="continue_review"]').count()) === 0 && (await ap.locator('[data-op="recheck"]').count()) === 1 && (await ap.locator('[data-op="cancel"]').count()) === 1,
  );
  const rc = await op(ap, oU.number, 'recheck', undefined, { reload: false });
  check('4e a new check queues a place job at the ORIGINAL price (the bot compares again), with an event', rc.ok && placeJobs(Number(bid(oU.number))) === 1 && Number(sql(`select payload->>'expected_total' from public.order_jobs where kind = 'place' and requested_by = 'shop' and (payload->>'order_id')::int = ${bid(oU.number)} limit 1`)) === Number(sql(`select live_total from ${S}.orders where id = ${oU.id}`)) && countEvent(oU.number, 'review_rechecked') === 1);

  await ap.goto(`${BASE}/admin/orders/${oX.number}`);
  check('4f an item missing: it cannot continue', (await ap.locator('[data-review-kind="unavailable"]').count()) === 1 && (await ap.locator('[data-op="continue_review"]').count()) === 0);
  const balX = balance(buyer);
  const smsBefore = smsSent(buyer.phone, 'order');
  const cx = await op(ap, oX.number, 'cancel', 'item gone', { reload: false });
  check(
    '4g cancel: the order is cancelled, the bot order is stopped, the WHOLE payment is back in the wallet once, the commission is cancelled, one SMS',
    cx.ok && status(oX.number) === 'canceled' && botStatus(bid(oX.number)) === 'canceled' && balance(buyer) === balX + total(oX) && ledger(oX.id, 'order-cancel-refund:%') === 1 && commissions(oX.number) === 'cancelled' && smsSent(buyer.phone, 'order') === smsBefore + 1 && countEvent(oX.number, 'canceled_by_admin') === 1,
  );

  // ── 5. two admins (two tabs) cancel the same queued order at once ──
  const t1 = await actx.newPage();
  const t2 = await actx.newPage();
  await t1.goto(`${BASE}/admin/orders/${oC.number}`);
  await t2.goto(`${BASE}/admin/orders/${oC.number}`);
  const balC = balance(buyer);
  for (const t of [t1, t2]) {
    await t.locator('[data-op="cancel"]').click();
    await t.locator('[data-confirm-dialog="operator"][open]').waitFor();
  }
  await Promise.all([t1, t2].map((t) => t.locator('[data-confirm-dialog="operator"] [data-confirm-yes]').click()));
  await Promise.all([t1, t2].map((t) => t.locator('[data-operator-result]').waitFor({ timeout: 30000 })));
  check(
    '5a two cancels at once: ONE refund, the balance moves once, the order is cancelled once',
    status(oC.number) === 'canceled' && ledger(oC.id, 'order-cancel-refund:%') === 1 && balance(buyer) === balC + total(oC) && countEvent(oC.number, 'canceled_by_admin') === 1,
  );
  await t1.close();
  await t2.close();

  // ── 6. a customer's cancel request ──
  await ap.goto(`${BASE}/admin`);
  const att = await ap.locator(`[data-attention-order="${oA.number}"]`).innerText();
  check('6a «نیازمند توجه» lists it as a cancel request, with a link to the order', att.includes('درخواست لغو') && (await ap.locator(`[data-attention-order="${oA.number}"] a`).count()) === 1);
  await ap.goto(`${BASE}/admin/orders/${oA.number}`);
  check('6b the order shows the request and offers approve / reject', (await ap.locator('[data-cancel-request]').count()) === 1 && (await ap.locator('[data-op="approve_cancel"]').count()) === 1 && (await ap.locator('[data-op="reject_cancel"]').count()) === 1);
  const balA = balance(buyer);
  const sA = smsSent(buyer.phone, 'order');
  const ca = await op(ap, oA.number, 'approve_cancel', undefined, { reload: false });
  check(
    '6c approving: cancelled, the whole payment back once, the bot order stopped, commissions cancelled, one SMS, the request answered',
    ca.ok && status(oA.number) === 'canceled' && botStatus(bid(oA.number)) === 'canceled' && balance(buyer) === balA + total(oA) && ledger(oA.id, 'order-cancel-refund:%') === 1 && commissions(oA.number) === 'cancelled' && smsSent(buyer.phone, 'order') === sA + 1 && countEvent(oA.number, 'cancel_request_approved') === 1,
  );
  await ap.goto(`${BASE}/admin/orders/${oB.number}`);
  await ap.locator('[data-op="reject_cancel"]').click();
  await ap.locator('[data-confirm-dialog="operator"][open]').waitFor();
  await ap.locator('[data-confirm-dialog="operator"] [data-confirm-yes]').click();
  await ap.locator('[data-operator-result="error"]').waitFor();
  check('6d rejecting needs a reason: nothing happened without one', countEvent(oB.number, 'cancel_request_rejected') === 0);
  const balB = balance(buyer);
  const sB = smsSent(buyer.phone, 'order');
  const rj = await op(ap, oB.number, 'reject_cancel', 'paid at the supplier already', { reload: false });
  check(
    '6e rejecting with a reason: the order goes on, no money moved, an event, the customer is told by SMS once',
    rj.ok && status(oB.number) === 'awaiting_payment' && balance(buyer) === balB && countEvent(oB.number, 'cancel_request_rejected') === 1 && smsSent(buyer.phone, 'order') === sB + 1,
  );
  await ap.goto(`${BASE}/admin/orders/${oB.number}`);
  check('6f the request is closed on the order page', (await ap.locator('[data-cancel-request]').count()) === 0 && (await ap.locator('[data-op="reject_cancel"]').count()) === 0);
  await bp.goto(`${BASE}/account/orders/${oB.number}`);
  check('6g the customer sees that the request was not accepted', (await bp.locator('body').innerText()).includes('درخواست لغو پذیرفته نشد'));

  // ── 7. the Liateam payment link and its clock ──
  await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  const href = await ap.locator('[data-payment-url]').getAttribute('href');
  check('7a the link the bot registered is shown, with a countdown (active)', href === `https://pay.example.test/${stamp}${oL.id}` && (await seen(ap, '[data-countdown="active"]')));
  sql(`update public.shop_orders set placed_at = now() - interval '17 minutes' where id = ${bid(oL.number)}`);
  await ap.reload();
  check('7b in its last five minutes the countdown is «expiring»', await seen(ap, '[data-countdown="expiring"]'));
  const opSms = smsSent(OPERATOR, 'other');
  await tick();
  await tick();
  await tick();
  check(
    '7c the worker raises ONE warning event and ONE operator SMS for it, however many ticks',
    countEvent(oL.number, 'payment_link_expiring') === 1 && smsSent(OPERATOR, 'other') === opSms + 1,
  );
  sql(`update public.shop_orders set placed_at = now() - interval '25 minutes' where id = ${bid(oL.number)}`);
  await ap.reload();
  check('7d past the end it says expired and how to get a new link', (await seen(ap, '[data-countdown="expired"]')) && (await ap.locator('[data-link-expired]').count()) === 1);
  sql(`update public.shop_orders set placed_at = now() - interval '3 minutes' where id = ${bid(oL.number)}`);

  // ── 8. paid at Liateam, in two tabs ──
  const m1 = await actx.newPage();
  const m2 = await actx.newPage();
  await m1.goto(`${BASE}/admin/orders/${oL.number}`);
  await m2.goto(`${BASE}/admin/orders/${oL.number}`);
  const pa = await op(m1, oL.number, 'mark_paid', 'PAY-REF-' + stamp, { reload: false });
  check(
    '8a «پرداخت شد» with a reference: supplier_paid, the reference and the admin in the events',
    pa.ok && status(oL.number) === 'supplier_paid' && countEvent(oL.number, 'supplier_paid_manual') === 1 && sql(`select data->>'ref' from ${S}.order_events where kind = 'supplier_paid_manual' and order_id = ${oL.id}`) === 'PAY-REF-' + stamp,
  );
  const pb = await op(m2, oL.number, 'mark_paid', 'PAY-REF-OTHER', { reload: false });
  check('8b the same press from the stale second tab changes nothing and says it was done', pb.ok && pb.text.includes('قبلاً') && countEvent(oL.number, 'supplier_paid_manual') === 1);
  await m1.close();
  await m2.close();
  await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  check('8c a paid order can no longer be cancelled by the operator', (await ap.locator('[data-op="cancel"]').count()) === 0 && (await ap.locator('[data-op="mark_paid"]').count()) === 0 && (await ap.locator('[data-op="ship"]').count()) === 1);
  check('8d the timeline names the admin who did it', (await ap.locator('[data-operator-timeline]').innerText()).includes('مدیر آزمون'));

  // ── 9. a stale page: the supplier was paid after the page loaded ──
  await ap.goto(`${BASE}/admin/orders/${oD.number}`);
  sql(`update public.shop_orders set status = 'supplier_paid' where id = ${bid(oD.number)}`);
  sh(`update ${S}.orders set status = 'supplier_paid' where id = ${oD.id}`);
  const balD = balance(buyer);
  const sd = await op(ap, oD.number, 'cancel', undefined, { reload: false });
  check('9a cancelling from a stale page is refused by the server: nothing refunded, nothing cancelled', !sd.ok && status(oD.number) === 'supplier_paid' && balance(buyer) === balD && ledger(oD.id, 'order-cancel-refund:%') === 0);

  // ── 10. sent ──
  const balL = balance(buyer);
  await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  const bad = await op(ap, oL.number, 'ship', '12', { reload: false });
  check('10a a bad tracking code is refused', !bad.ok && status(oL.number) === 'supplier_paid');
  const shipSms = smsSent(buyer.phone, 'shipping');
  const shipped = await op(ap, oL.number, 'ship', 'RR' + stamp + '123IR', { reload: false });
  check(
    '10b a valid code: sent, the code saved, the commission is released (pending with a date), ONE «shipped» SMS',
    shipped.ok && status(oL.number) === 'sent' && sql(`select tracking->>'code' from ${S}.orders where id = ${oL.id}`) === 'RR' + stamp + '123IR' && smsSent(buyer.phone, 'shipping') === shipSms + 1 && sql(`select count(*) from ${S}.commissions where order_id = ${oL.id} and status = 'pending' and release_at is not null`) === '1',
  );
  await bp.goto(`${BASE}/account/orders/${oL.number}`);
  check('10c the customer sees the tracking code', (await bp.locator('body').innerText()).includes('RR' + stamp + '123IR'));
  await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  check('10d after sending: no cancel, no ship; the manual return is offered', (await ap.locator('[data-op="cancel"]').count()) === 0 && (await ap.locator('[data-op="ship"]').count()) === 0 && (await ap.locator('[data-op="manual_return"]').count()) === 1);
  const mr = await op(ap, oL.number, 'manual_return', 'refund by bank transfer, handled by the operator', { reload: false });
  check('10e the manual return only writes a note and an event: no wallet row, no status change', mr.ok && balance(buyer) === balL && status(oL.number) === 'sent' && countEvent(oL.number, 'manual_return_noted') === 1);

  // ── 11. private notes and the audit ──
  const secret = 'INTERNAL-NOTE-' + stamp;
  const nt = await op(ap, oL.number, 'note', secret);
  await ap.goto(`${BASE}/admin/orders/${oL.number}`);
  check('11a a note is saved and listed with its author', nt.ok && (await ap.locator('[data-note]').count()) >= 2 && (await ap.locator('[data-notes]').innerText()).includes(secret) && (await ap.locator('[data-notes]').innerText()).includes('مدیر آزمون'));
  await bp.goto(`${BASE}/account/orders/${oL.number}`);
  check('11b the customer never sees a note', !(await bp.locator('body').innerText()).includes(secret) && !(await bp.locator('body').innerText()).includes('refund by bank transfer'));
  const phones = [buyer.phone, adminPhone];
  const leaks = phones.map((p) => Number(sql(`select count(*) from ${S}.audit_log where action like 'order.%' and meta::text like '%${p}%'`)));
  const acts = sql(`select string_agg(distinct action, ',' order by action) from ${S}.audit_log where entity_type = 'order' and action like 'order.%' and actor_user_id = (select id from ${S}.users where phone = '${adminPhone}')`);
  check('11c every action is in the audit log and no whole phone number is', leaks.every((n) => n === 0) && ['order.cancel', 'order.cancel_approved', 'order.cancel_rejected', 'order.mark_paid', 'order.note', 'order.place', 'order.recheck', 'order.review_continue', 'order.ship'].every((a) => acts.split(',').includes(a)));
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
