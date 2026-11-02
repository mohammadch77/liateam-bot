// The customer panel on a WebKit phone (iPhone 8, the narrowest of the profiles), by TAP: the tab row, every account page without
// sideways scroll, 44px controls, the cancel dialog fitting the screen and cancelling a paid order, the address form. One run.
// The stand-in bot (_responder.mjs) answers the bot's jobs; orders are seeded in the database. Invented numbers, new every run.
import {
  BASE,
  SCHEMA as S,
  check,
  devices,
  finish,
  requireLocalApp,
  signIn,
  sql,
  webkit,
} from './_harness.mjs';
import { enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { makeUser } = seeder('09997', stamp);
const PHONES = `select phone from ${S}.users where phone like '09997%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where order_id in (${OIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.addresses where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});`);

const bot = startResponder();
const restorePay = await enablePayment({ 'orders.auto_place_enabled': false });
const browser = await webkit.launch();
try {
  wipe();
  const user = makeUser(1);
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${user.id}, 'topup', 20000000, 0, 'topup-m-${stamp}')`,
  );
  const ctx = await browser.newContext({ ...devices['iPhone 8'] });
  const p = await ctx.newPage();
  const flat = async () =>
    (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;
  const small = (sel) =>
    p.evaluate(
      (s) =>
        [...document.querySelectorAll(s)].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 43.5;
        }).length,
      sel,
    );
  await signIn(p, user.phone);

  const order = seedOrder(user);
  await p.goto(`${BASE}/account/orders/${order.number}`);
  await p.locator('[data-pay-option="wallet"] input').check();
  await p.locator('[data-pay-submit]').tap();
  await p.waitForURL(/paid=1/, { timeout: 40000 });

  for (const [name, path] of [
    ['dashboard', '/account'],
    ['orders', '/account/orders'],
    ['wallet', '/account/wallet'],
    ['profile', '/account/profile'],
    ['addresses', '/account/addresses'],
  ]) {
    await p.goto(`${BASE}${path}`);
    check(
      `1 ${name}: no sideways scroll, the tab row's links are 44px+`,
      (await flat()) && (await small('[data-account-nav] a')) === 0,
    );
  }
  await p.goto(`${BASE}/account/orders`);
  check('2 the order list: the filter chips are 44px+', (await small('[data-order-filters] a')) === 0);

  await p.goto(`${BASE}/account/orders/${order.number}`);
  check(
    '3a the order page: the cancel panel fits and its buttons are 44px+',
    (await flat()) && (await small('[data-cancel-panel] button')) === 0,
  );
  await p.locator('[data-cancel-open]').tap();
  const box = await p.locator('[data-confirm-dialog="order-cancel"]').boundingBox();
  const vp = p.viewportSize();
  check(
    '3b the confirmation fits the phone screen and shows the refund',
    !!box &&
      box.x >= 0 &&
      box.x + box.width <= vp.width + 1 &&
      (await p.locator('[data-cancel-refund]').count()) === 1,
  );
  check('3c its buttons are 44px+', (await small('[data-confirm-dialog="order-cancel"] button')) === 0);
  await p.locator('[data-confirm-dialog="order-cancel"] [data-confirm-yes]').tap();
  await p.waitForFunction(() => document.body.innerText.includes('برگشت'), null, { timeout: 20000 });
  check(
    '3d cancelled by tap: canceled, the whole payment back in the wallet',
    sql(`select status from ${S}.orders where id = ${order.id}`) === 'canceled' &&
      Number(
        sql(`select count(*) from ${S}.wallet_ledger where order_id = ${order.id} and kind = 'refund'`),
      ) === 1 &&
      (await flat()),
  );

  await p.goto(`${BASE}/account/addresses`);
  check(
    '4a the address form: fields are 44px+ and the page does not scroll sideways',
    (await flat()) &&
      (await small('[data-address-form] input:not([type="checkbox"]), [data-address-form] select')) === 0,
  );
  await ctx.close();
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
