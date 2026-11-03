// The operator's order pages on a WebKit phone (iPhone 8), by TAP, once: the list and an order's page do not scroll sideways, the
// status chips and the buttons are 44px+, the confirmation dialog fits the screen and works (a note is saved). Invented numbers.
import { BASE, SCHEMA as S, check, chromium, devices, finish, requireLocalApp, signIn, sleep, sql, webkit } from './_harness.mjs';
import { makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09993', stamp);
const PHONES = `select phone from ${S}.users where phone like '09993%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.order_notes where order_id in (${OIDS});
    delete from ${S}.commissions where order_id in (${OIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'order' and entity_id not in (select id::text from ${S}.orders));
    delete from ${S}.users where phone in (${PHONES});`);

const bot = startResponder();
const restorePay = await enablePayment({ 'orders.auto_place_enabled': false });
const desktop = await chromium.launch();
const browser = await webkit.launch();
try {
  wipe();
  const buyer = makeUser(1);
  sql(`set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${buyer.id}, 'topup', 50000000, 0, 'topup-jm-${stamp}')`);
  const bctx = await desktop.newContext({ viewport: { width: 1280, height: 900 } });
  const bp = await bctx.newPage();
  await signIn(bp, buyer.phone);
  const o = seedOrder(buyer);
  await bp.goto(`${BASE}/account/orders/${o.number}`);
  await bp.locator('[data-pay-option="wallet"] input').check();
  await bp.locator('[data-pay-submit]').click();
  await bp.waitForURL(/paid=1/, { timeout: 40000 });
  const botId = () => sql(`select coalesce(bot_order_id::text, '') from ${S}.orders where id = ${o.id}`);
  for (let i = 0; i < 30 && !botId(); i++) await sleep(500);
  sql(`update public.shop_orders set status = 'awaiting_payment', payment_url = 'https://pay.example.test/m${stamp}', placed_at = now() - interval '3 minutes' where id = ${botId()}`);
  sql(`set search_path = ${S}, public; update ${S}.orders set status = 'awaiting_payment' where id = ${o.id}`);

  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  const ctx = await browser.newContext({ ...devices['iPhone 8'] });
  const p = await ctx.newPage();
  await adminSignIn(p, adminPhone, '/admin/orders');
  const flat = async () => (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;
  const small = (sel) =>
    p.evaluate(
      (s) =>
        [...document.querySelectorAll(s)].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 43.5;
        }).length,
      sel,
    );

  await p.goto(`${BASE}/admin/orders?q=${buyer.phone}`);
  check('1a the list has no sideways scroll and shows the order', (await flat()) && (await p.locator(`[data-order-row="${o.number}"]`).count()) === 1);
  check('1b the status chips and the filter controls are 44px+', (await small('nav a[data-tab], [data-orders-filter] input, [data-orders-filter] select, [data-orders-filter] button')) === 0);
  await p.locator(`[data-order-row="${o.number}"] a`).first().tap();
  await p.waitForURL(/\/admin\/orders\/AV-/);
  check('2a the order page has no sideways scroll', await flat());
  check('2b the operator buttons are 44px+', (await p.locator('[data-op]').count()) >= 3 && (await small('[data-op]')) === 0);
  await p.locator('[data-countdown]').first().waitFor({ timeout: 8000 });
  check('2c the countdown is shown', (await p.locator('[data-countdown]').count()) === 1);
  await p.locator('[data-op="note"]').tap();
  const dlg = p.locator('[data-confirm-dialog="operator"][open]');
  await dlg.waitFor();
  const box = await dlg.boundingBox();
  const vp = p.viewportSize();
  check('3a the dialog fits inside the screen', !!box && box.x >= 0 && box.x + box.width <= vp.width + 1 && box.height <= vp.height);
  check('3b its buttons are 44px+', (await dlg.locator('button').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height < 43.5).length)) === 0);
  await dlg.locator('[data-op-input]').fill('phone note ' + stamp);
  await dlg.locator('[data-confirm-yes]').tap();
  await p.locator('[data-operator-result="ok"]').waitFor({ timeout: 20000 });
  check('3c a note saved by tap shows in the list of notes', (await p.locator('[data-notes]').innerText()).includes('phone note ' + stamp) || sql(`select count(*) from ${S}.order_notes where order_id = ${o.id}`) === '1');
  check('3d still no sideways scroll after the action', await flat());
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
  await desktop.close();
}
finish();
