// The customer panel (task E), end to end on the dev simulator gateway and a stand-in bot (_responder.mjs): the dashboard, the
// order list and its filters, another user's order (404), cancelling a paid order (the whole payment back to the wallet, the
// bot's order stopped, commissions cancelled, one SMS, a second click / a second tab changes nothing), editing (cart refilled),
// the refusals (too late, switched off, the worker holding the order), a cancel request while the order is being placed (shown to
// the admin), the address book. Orders are seeded in the database; invented numbers, new for every run; nothing leaves this machine.
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  BASE,
  SCHEMA as S,
  check,
  chromium,
  finish,
  repoRoot,
  requireLocalApp,
  sleep,
  sql,
  toLatin,
} from './_harness.mjs';
import { makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { enablePayment, setSetting } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { signIn } from './_harness.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09996', stamp);
const PHONES = `select phone from ${S}.users where phone like '09996%'`;
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
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.addresses where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'user' and entity_id in (select id::text from ${S}.users where phone in (${PHONES})));
    delete from ${S}.users where phone in (${PHONES});
    delete from ${S}.commission_rules;`);

const row = (n) =>
  sql(
    `select status || '|' || coalesce(bot_order_id::text, '') from ${S}.orders where number = '${n}'`,
  ).split('|');
const events = (n) =>
  sql(
    `select coalesce(string_agg(kind, ',' order by id), '') from ${S}.order_events where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const balance = (u) =>
  Number(
    sql(
      `select coalesce((select balance_after from ${S}.wallet_ledger where user_id = ${u.id} order by id desc limit 1), 0)`,
    ),
  );
const ledger = (id, kind) =>
  Number(sql(`select count(*) from ${S}.wallet_ledger where order_id = ${id} and kind = '${kind}'`));
const botStatus = (botId) => sql(`select status from public.shop_orders where id = ${botId}`);
const commissions = (n) =>
  sql(
    `select coalesce(string_agg(status::text, ','), '') from ${S}.commissions where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const smsCanceled = (p) =>
  Number(
    sql(`select count(*) from ${S}.sms_log where phone = '${p}' and purpose = 'order' and status = 'sent'`),
  );
const topup = (u, amount, key) =>
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${u.id}, 'topup', ${amount}, 0, '${key}-${stamp}')`,
  );

const bot = startResponder();
const restorePay = await enablePayment({
  'orders.auto_place_enabled': false, // paid orders wait in the queue: the cancel window the customer has
  'sms.provider': 'dev',
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

/** a paid, queued order with its bot order, paid from the wallet through the real order page */
async function paidOrder(page, user) {
  const o = seedOrder(user);
  await page.goto(`${BASE}/account/orders/${o.number}`);
  await page.locator('[data-pay-option="wallet"] input').check();
  await page.locator('[data-pay-submit]').click();
  await page.waitForURL(/paid=1/, { timeout: 40000 });
  return o;
}
const openCancel = async (page, number, which = 'cancel') => {
  await page.goto(`${BASE}/account/orders/${number}`);
  await page.locator(`[data-${which}-open]`).click();
  await page.locator(`[data-confirm-dialog="order-${which}"][open]`).waitFor();
};
const confirm = (page, which = 'cancel') =>
  page.locator(`[data-confirm-dialog="order-${which}"] [data-confirm-yes]`).click();

let adminCtx;
try {
  wipe();
  const buyer = makeUser(1);
  const ref1 = makeUser(2);
  const other = makeUser(3);
  sql(
    `insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${buyer.id}, ${ref1.id}, 'refc${stamp}')`,
  );
  sql(
    `insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active) values ('l1', 'percent', 5, 'all', 1, 7, true)`,
  );
  topup(buyer, 20_000_000, 'topup-a');
  const { page } = await open(buyer);

  // ── 1. dashboard, list, filters, ownership ──
  const p0 = seedOrder(buyer); // pending_payment
  await page.goto(`${BASE}/account`);
  check(
    '1a dashboard: current orders = 1 and the wallet balance',
    num(await page.locator('[data-stat-active]').innerText()) === 1 &&
      num(await page.locator('[data-stat-balance]').innerText()) === 20_000_000,
  );
  check('1b the side menu has the seven pages (favourites and the affiliate entry for everyone since task K)', (await page.locator('[data-account-nav] a').count()) === 7);
  await page.goto(`${BASE}/account/orders`);
  check(
    '1c the order list shows the order',
    (await page.locator(`[data-order-row="${p0.number}"]`).count()) === 1,
  );
  await page.goto(`${BASE}/account/orders?status=sent`);
  check(
    '1d the «sent» filter shows none, with an empty state',
    (await page.locator('[data-order-row]').count()) === 0,
  );
  await page.goto(`${BASE}/account/orders?status=pending`);
  check(
    '1e the «pending» filter shows it',
    (await page.locator(`[data-order-row="${p0.number}"]`).count()) === 1,
  );
  check(
    '1f an unknown filter falls back to all',
    await page.goto(`${BASE}/account/orders?status=zzz&page=-4`).then((r) => r?.ok() === true),
  );
  const otherCtx = await open(other);
  const r404 = await otherCtx.page.goto(`${BASE}/account/orders/${p0.number}`);
  check("1g another user's order number is a 404", r404?.status() === 404);
  await otherCtx.page.goto(`${BASE}/account/orders`);
  check(
    "1h and is not in the other user's list",
    (await otherCtx.page.locator(`[data-order-row]`).count()) === 0,
  );

  // ── 2. cancel a pending order: nothing to return ──
  await openCancel(page, p0.number);
  check(
    '2a the pending cancel dialog says nothing was paid',
    (await page.locator('[data-confirm-dialog="order-cancel"]').innerText()).includes('مبلغی از شما کم نشده'),
  );
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('سفارش لغو شد'));
  check(
    '2b the order is canceled, the wallet unchanged',
    row(p0.number)[0] === 'canceled' && balance(buyer) === 20_000_000 && ledger(p0.id, 'refund') === 0,
    row(p0.number)[0],
  );

  // ── 3. cancel a paid order (queued, not placed): everything at once ──
  const o1 = await paidOrder(page, buyer);
  check(
    '3a paid from the wallet: queued with a bot order, waiting for the operator',
    row(o1.number)[0] === 'queued' && row(o1.number)[1] !== '',
    row(o1.number).join('|'),
  );
  const botId = row(o1.number)[1];
  check(
    '3b the bot order is queued, a commission is pending',
    botStatus(botId) === 'queued' && commissions(o1.number) === 'pending',
  );
  await page.goto(`${BASE}/account/orders/${o1.number}`);
  const timeline = await page.locator('[data-order-timeline]').innerText();
  check(
    '3c the timeline shows the payment and the queue in Persian',
    timeline.includes('پرداخت انجام شد') && timeline.includes('در صف ثبت'),
  );
  await page.locator('[data-cancel-open]').click();
  const dlg = await page.locator('[data-confirm-dialog="order-cancel"]').innerText();
  check(
    '3d the second confirmation shows the refund amount',
    num(await page.locator('[data-cancel-refund] b').innerText()) === o1.payable && dlg.includes('کیف پول'),
    dlg.slice(0, 80),
  );
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('برگشت'));
  check(
    '3e canceled; the whole payment is back in the wallet, once',
    row(o1.number)[0] === 'canceled' && balance(buyer) === 20_000_000 && ledger(o1.id, 'refund') === 1,
    `${row(o1.number)[0]} ${balance(buyer)}`,
  );
  check(
    "3f the bot's order can no longer be placed (canceled); its place job, if any, is closed",
    botStatus(botId) === 'canceled',
  );
  check('3g the commission is cancelled', commissions(o1.number) === 'cancelled', commissions(o1.number));
  check(
    '3h the event and the one SMS',
    events(o1.number).includes('canceled_by_customer') &&
      events(o1.number).includes('sms_canceled') &&
      smsCanceled(buyer.phone) === 1,
    events(o1.number),
  );
  await page.goto(`${BASE}/account/orders/${o1.number}`);
  const stepTexts = await page.locator('[data-step]').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
  const lastStep = page.locator('[data-step]').last();
  check(
    '3h2 the timeline ends with the cancel (final, strongest) and says how much went back to the wallet',
    (await lastStep.getAttribute('data-final')) === 'true' &&
      stepTexts.at(-1).includes('لغو شد') &&
      num(await lastStep.locator('[data-step-note]').innerText()) === o1.payable,
    stepTexts.at(-1),
  );
  await page.goto(`${BASE}/account/orders/${o1.number}`);
  check(
    '3i the order page: canceled, no cancel button any more',
    (await page.locator('[data-cancel-panel]').count()) === 0 &&
      (await page.locator('body').innerText()).includes('لغو شده'),
  );
  await page.goto(`${BASE}/account/wallet`);
  check(
    '3j the wallet page lists the refund and offers the charge form (no withdrawal for a plain customer)',
    (await page.locator('[data-wallet-entry="refund"]').count()) >= 1 &&
      (await page.locator('[data-topup]').count()) === 1 &&
      (await page.locator('[data-withdraw]').count()) === 0,
  );

  // ── 4. a second click / a second tab cancels once ──
  const o2 = await paidOrder(page, buyer);
  const tab2 = await page.context().newPage();
  await openCancel(page, o2.number);
  await openCancel(tab2, o2.number);
  await Promise.all([confirm(page), confirm(tab2)]);
  await sleep(2500);
  check(
    '4a two tabs confirming together: one refund row, the balance right',
    ledger(o2.id, 'refund') === 1 && balance(buyer) === 20_000_000 && row(o2.number)[0] === 'canceled',
    `${ledger(o2.id, 'refund')} ${balance(buyer)}`,
  );
  check('4b and one SMS for it', smsCanceled(buyer.phone) === 2, String(smsCanceled(buyer.phone)));
  await tab2.close();

  // ── 5. edit: cancel + the cart refilled + sent to the cart ──
  const o3 = await paidOrder(page, buyer);
  const qty = Object.fromEntries(
    sql(
      `select string_agg(product_id || ':' || quantity, ',') from ${S}.order_items where order_id = ${o3.id}`,
    )
      .split(',')
      .map((r) => r.split(':')),
  );
  await openCancel(page, o3.number, 'edit');
  check(
    '5a the edit dialog explains the cancel, the refund and the cart',
    (await page.locator('[data-edit-note]').innerText()).includes('سبد برای ویرایش آماده می‌شود'),
  );
  await confirm(page, 'edit');
  await page.waitForURL(/\/cart/, { timeout: 30000 });
  const cart = Object.fromEntries(
    (
      sql(
        `select coalesce(string_agg(product_id || ':' || quantity, ','), '') from ${S}.cart_items where cart_id = (select id from ${S}.carts where user_id = ${buyer.id} and status = 'open') and quantity > 0`,
      ) || ''
    )
      .split(',')
      .filter(Boolean)
      .map((r) => r.split(':')),
  );
  check(
    '5b the old order is canceled and refunded',
    row(o3.number)[0] === 'canceled' && ledger(o3.id, 'refund') === 1 && balance(buyer) === 20_000_000,
  );
  check(
    '5c the cart holds the same lines and quantities',
    Object.keys(qty).length >= 2 && Object.entries(qty).every(([k, v]) => cart[k] === v),
    JSON.stringify(cart),
  );

  // ── 6. refusals: too late, switched off, the worker holds the order ──
  const o4 = await paidOrder(page, buyer);
  await openCancel(page, o4.number);
  sql(
    `set search_path = ${S}, public; update ${S}.orders set status = 'awaiting_payment' where id = ${o4.id}; update ${S}.orders set status = 'supplier_paid' where id = ${o4.id}`,
  );
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('دیگر قابل لغو نیست'));
  check(
    '6a the order moved on to «supplier paid» while the dialog was open: refused, nothing changed',
    row(o4.number)[0] === 'supplier_paid' && ledger(o4.id, 'refund') === 0 && balance(buyer) < 20_000_000,
  );
  await page.goto(`${BASE}/account/orders/${o4.number}`);
  check(
    '6b at «supplier paid» the page has no cancel or edit button',
    (await page.locator('[data-cancel-panel]').count()) === 0,
  );

  const o5 = await paidOrder(page, buyer);
  await openCancel(page, o5.number);
  await setSetting('orders.customer_cancel_enabled', false);
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('غیرفعال است'));
  check(
    '6c the admin switch is off: refused by the server, the order untouched',
    row(o5.number)[0] === 'queued' && ledger(o5.id, 'refund') === 0,
  );
  await page.goto(`${BASE}/account/orders/${o5.number}`);
  check('6d and the buttons are hidden', (await page.locator('[data-cancel-panel]').count()) === 0);
  await setSetting('orders.customer_cancel_enabled', true);

  await openCancel(page, o5.number);
  const holder = spawn(
    'docker',
    [
      'compose',
      '-f',
      path.join(repoRoot, 'docker-compose.yml'),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'lia',
      'lia_sync',
      '-c',
      `begin; select pg_advisory_xact_lock(hashtextextended('order-advance:${o5.id}', 0)); select pg_sleep(7); commit;`,
    ],
    { stdio: 'ignore' },
  );
  await sleep(2500); // the worker "has" the order now
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('در حال پیشروی'), null, {
    timeout: 15000,
  });
  check(
    '6e the worker holds the order at that moment: a plain «try in a few seconds», nothing half done',
    row(o5.number)[0] === 'queued' &&
      ledger(o5.id, 'refund') === 0 &&
      botStatus(row(o5.number)[1]) === 'queued',
  );
  await new Promise((r) => holder.on('close', r));
  await openCancel(page, o5.number);
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('برگشت'), null, { timeout: 15000 });
  check(
    '6f once the worker lets go, the same cancel goes through',
    row(o5.number)[0] === 'canceled' && ledger(o5.id, 'refund') === 1,
  );

  // ── 7. while the order is being placed / placed: a request, shown to the admin; no money moves ──
  const o6 = await paidOrder(page, buyer);
  const before = balance(buyer);
  sql(`update public.shop_orders set status = 'awaiting_payment' where id = ${row(o6.number)[1]}`);
  await page.goto(`${BASE}/account/orders/${o6.number}`); // the page follows the bot: awaiting_payment
  check(
    '7a the order followed the bot to «awaiting_payment»; editing is not offered',
    row(o6.number)[0] === 'awaiting_payment' &&
      (await page.locator('[data-edit-open]').count()) === 0 &&
      (await page.locator('[data-cancel-open]').count()) === 1,
    row(o6.number)[0],
  );
  await page.locator('[data-cancel-open]').click();
  await confirm(page);
  await page.waitForFunction(() => document.body.innerText.includes('درخواست لغو ثبت شد'));
  check(
    '7b a cancel_requested event (once), the status and the money untouched',
    events(o6.number)
      .split(',')
      .filter((k) => k === 'cancel_requested').length === 1 &&
      row(o6.number)[0] === 'awaiting_payment' &&
      balance(buyer) === before &&
      ledger(o6.id, 'refund') === 0,
  );
  await page.reload();
  check(
    '7c the page now shows the request, with no second button',
    (await page.locator('[data-cancel-panel]').count()) === 0,
  );
  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await adminCtx.newPage();
  await adminSignIn(ap, adminPhone, '/admin');
  check(
    '7d the admin sees it under «نیازمند توجه» as a cancel request',
    (await ap.locator(`[data-attention-order="${o6.number}"]`).innerText()).includes('درخواست لغو'),
  );

  // ── 8. the address book ──
  await page.goto(`${BASE}/account/addresses`);
  check('8a no addresses yet: the form is open', (await page.locator('[data-address-form]').count()) === 1);
  const fill = async (name, line) => {
    await page.getByLabel('نام و نام خانوادگی گیرنده').fill(name);
    await page.getByLabel('استان').selectOption({ label: 'تهران' });
    await page.getByLabel('شهر').selectOption({ label: 'تهران' });
    await page.getByLabel('کد پستی').fill('1234567890');
    await page.getByLabel('پلاک').fill('12');
    await page.getByLabel('نشانی کامل').fill(line);
  };
  await page.locator('[data-address-form] select').first().waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('select[name="province"] option').length > 1,
    null,
    { timeout: 30000 },
  );
  await fill('آزمون اول', 'خیابان آزمون، کوچه‌ی اول');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await page.locator('[data-address]').first().waitFor();
  check(
    '8b the first address is saved and is the default',
    (await page.locator('[data-address][data-default="true"]').count()) === 1,
  );
  await page.locator('[data-add-address]').click();
  await page.waitForFunction(
    () => document.querySelectorAll('select[name="province"] option').length > 1,
    null,
    { timeout: 30000 },
  );
  await fill('آزمون دوم', 'خیابان آزمون، کوچه‌ی دوم');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-address]').length === 2);
  check(
    '8c a second address is added, the first stays the default',
    (await page.locator('[data-address][data-default="true"]').innerText()).includes('آزمون اول'),
  );
  await page.locator('[data-address]:not([data-default="true"]) [data-address-edit]').click();
  await page.waitForFunction(() => document.querySelectorAll('select[name="city"] option').length > 1, null, {
    timeout: 30000,
  });
  await page.getByLabel('نام و نام خانوادگی گیرنده').fill('آزمون ویرایش‌شده');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('آزمون ویرایش‌شده'));
  check(
    '8d editing saves the change',
    sql(
      `select count(*) from ${S}.addresses where user_id = ${buyer.id} and recipient_name = 'آزمون ویرایش‌شده'`,
    ) === '1',
  );
  await page.locator('[data-address]:not([data-default="true"]) [data-address-default]').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-address][data-default="true"]')?.textContent?.includes('آزمون ویرایش‌شده'),
  );
  check(
    '8e «پیش‌فرض شود» moves the default (still exactly one)',
    sql(`select count(*) from ${S}.addresses where user_id = ${buyer.id} and is_default`) === '1',
  );
  await page.locator('[data-address][data-default="true"] [data-address-delete]').click();
  await page.locator('[data-confirm-dialog="address-delete"][open]').waitFor();
  await page.locator('[data-confirm-dialog="address-delete"] [data-confirm-yes]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-address]').length === 1);
  check(
    '8f deleting asks first, archives the address (never removed), and the other becomes the default',
    sql(`select count(*) from ${S}.addresses where user_id = ${buyer.id} and archived_at is not null`) ===
      '1' &&
      sql(
        `select count(*) from ${S}.addresses where user_id = ${buyer.id} and archived_at is null and is_default`,
      ) === '1',
  );
  await otherCtx.page.goto(`${BASE}/account/addresses`);
  check(
    '8g another user sees none of these addresses',
    (await otherCtx.page.locator('[data-address]').count()) === 0,
  );

  // ── 9. profile ──
  await page.goto(`${BASE}/account/profile`);
  check(
    '9a the mobile number is read-only',
    (await page.getByLabel('شماره‌ی موبایل').getAttribute('readonly')) !== null,
  );
  await page.getByLabel('نام و نام‌خانوادگی').fill('خریدار آزمون');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('ذخیره شد'));
  check(
    '9b the name is saved',
    sql(`select full_name from ${S}.users where id = ${buyer.id}`) === 'خریدار آزمون',
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
