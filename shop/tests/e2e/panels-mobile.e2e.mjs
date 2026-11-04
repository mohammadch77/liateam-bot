// The pages task K changed, on a WebKit phone (iPhone 8), by TAP, once: the checkout (steps, the compact summary bar above the bottom menu,
// the reason under the pay button), the favourites page and the hearts, the affiliate's dashboard (code uses + QR), a referred person's
// page, the printable banner, the admin panel's tab menu, the «بازگشت» link and the sign-in's code box. No sideways scroll, 44px targets.
// Invented numbers.
import { BASE, SCHEMA as S, check, chromium, devices, finish, requireLocalApp, sql, webkit } from './_harness.mjs';
import { makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09997', stamp);
const PHONES = `select phone from ${S}.users where phone like '09997%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
if (Number(sql(`select count(*) from ${S}.commission_rules`)) > 0) {
  console.error('commission_rules is not empty in the local database; this test replaces its rows. Empty it first.');
  process.exit(2);
}
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where order_id in (${OIDS}) or affiliate_user_id in (${UIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.favorites where user_id in (${UIDS});
    delete from ${S}.affiliate_referrals where buyer_user_id in (${UIDS}) or referrer_user_id in (${UIDS});
    delete from ${S}.affiliate_codes where user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.addresses where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});
    delete from public.order_jobs where requested_by = 'shop' and done_at is null;
    delete from ${S}.commission_rules;`);

const pid = sql(`select id from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 order by id limit 1`);
const bot = startResponder();
const restorePay = await enablePayment({ 'orders.auto_place_enabled': false });
const desktop = await chromium.launch();
const browser = await webkit.launch();
try {
  wipe();
  const A = makeUser(1); // the affiliate
  const N = makeUser(2); // a referred buyer with a paid order
  const C = makeUser(3); // a customer with a cart (checkout, favourites)
  sql(`insert into ${S}.user_roles (user_id, role) values (${A.id}, 'affiliate')`);
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${A.id}, 'mm${stamp}x')`);
  sql(`insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${N.id}, ${A.id}, 'mm${stamp}x')`);
  sql(`insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active) values ('rr', 'percent', 10, 'all', 1, 3, true)`);
  sql(`set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${N.id}, 'topup', 90000000, 0, 'topup-m-${stamp}')`);
  const dctx = await desktop.newContext({ viewport: { width: 1280, height: 900 } });
  const dp = await dctx.newPage();
  await adminSignIn(dp, N.phone, '/');
  const o = seedOrder(N);
  await dp.goto(`${BASE}/account/orders/${o.number}`);
  await dp.locator('[data-pay-option="wallet"] input').check();
  await dp.locator('[data-pay-submit]').click();
  await dp.waitForURL(/paid=1/, { timeout: 40000 });
  sql(`insert into ${S}.addresses (user_id, province, city, line, recipient_name, recipient_phone, postal_code, is_default, province_id, city_id, plate) values (${C.id}, 'تهران', 'تهران', 'خیابان آزمون، کوچه‌ی تست', 'خریدار', '${C.phone}', '1234567890', true, 1, 5, '12')`);
  sql(`insert into ${S}.carts (user_id) values (${C.id})`);
  sql(`insert into ${S}.cart_items (cart_id, product_id, quantity) select id, ${pid}, 1 from ${S}.carts where user_id = ${C.id} and status = 'open'`);
  sql(`insert into ${S}.favorites (user_id, product_id) values (${C.id}, ${pid})`);
  makeAdmin(phone(9));

  const session = async (user, next = '/') => {
    const ctx = await browser.newContext({ ...devices['iPhone 8'], extraHTTPHeaders: { 'x-real-ip': `10.${stamp.slice(-2)}.${Math.floor(Math.random() * 200) + 20}.1` } });
    const p = await ctx.newPage();
    await adminSignIn(p, user, next);
    return { ctx, p };
  };
  const flat = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);
  const small = (p, sel) =>
    p.evaluate(
      (s) => [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).length,
      sel,
    );

  // ── the checkout ──
  const { ctx: cctx, p: c } = await session(C.phone, '/');
  await c.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('1a the checkout does not scroll sideways', await flat(c));
  check('1b the three steps are shown', (await c.locator('[data-checkout-steps] li').count()) === 3);
  const bar = c.locator('[data-checkout-bar]');
  const barBox = await bar.boundingBox();
  const nav = await c.locator('nav[aria-label]').last().boundingBox().catch(() => null);
  check('1c the compact summary bar is on screen (fixed above the bottom menu) with the total', !!barBox && barBox.y + barBox.height <= 667 && (await bar.innerText()).includes('تومان'));
  check('1d the bar\'s button and the pay button are 44px+, and the hearts / chips too', (await small(c, '[data-checkout-bar] button, [data-checkout-bar] a, [data-place-order], [data-pay-option], [data-referral-box] button')) === 0, String(nav?.y));
  await c.locator('[data-bar-go]').tap();
  check('1e the bar takes the customer to the full summary and pay button', await c.locator('[data-place-order]').isVisible());
  await c.setViewportSize({ width: 375, height: 667 });

  // ── favourites ──
  await c.goto(`${BASE}/account/favorites`, { waitUntil: 'load' });
  check('2a the favourites page does not scroll sideways', await flat(c));
  check('2b the list shows the product, the heart and «حذف از لیست» are 44px+', (await c.locator('[data-favorite-item]').count()) === 1 && (await small(c, '[data-favorite-item] [data-favorite], [data-favorite-item] [data-favorite-remove]')) === 0);
  await c.locator('[data-favorite-item] [data-favorite]').tap();
  await c.locator('[data-cart-toast]').waitFor({ timeout: 15000 });
  check('2c a tap on the heart works (the list item is on its way out of the list: the heart turned off)', (await c.locator('[data-favorite-item] [data-favorite]').getAttribute('data-favorite')) === 'off');
  // «بازگشت»
  await c.goto(`${BASE}/account/wallet`, { waitUntil: 'load' });
  check('2d «بازگشت» is a 44px target on the wallet page', (await c.locator('[data-back]').count()) === 1 && (await small(c, '[data-back]')) === 0);
  check('2e the account menu (tabs) is 44px and does not push the page sideways', (await small(c, '[data-account-nav] a')) === 0 && (await flat(c)));
  await cctx.close();

  // ── the affiliate ──
  const { ctx: actx, p: ap } = await session(A.phone, '/account/affiliate');
  await ap.goto(`${BASE}/account/affiliate`, { waitUntil: 'load' });
  check('3a the dashboard (code, uses, QR) does not scroll sideways', await flat(ap));
  const qr = await ap.locator('[data-qr]').boundingBox();
  check('3b the QR is shown at a scannable size (about 168px) and its buttons are 44px+', !!qr && qr.width >= 150 && (await small(ap, '[data-qr-svg], [data-qr-png], [data-qr-banner]')) === 0);
  await ap.goto(`${BASE}/account/affiliate/network`, { waitUntil: 'load' });
  await ap.locator('[data-person-link]').tap();
  await ap.waitForURL(/\/network\/[0-9a-z]+-[0-9a-f]{12}$/);
  check('3c the referred person\'s page fits the phone, Excel and PDF buttons are 44px+', (await flat(ap)) && (await small(ap, '[data-xlsx], [data-print-pdf]')) === 0 && (await ap.locator('[data-person-order]').count()) === 1);
  await ap.goto(`${BASE}/account/affiliate/banner`, { waitUntil: 'load' });
  check('3d the banner page fits the phone', (await flat(ap)) && (await ap.locator('[data-banner-qr] svg').count()) === 1);
  await actx.close();

  // ── the admin menu ──
  const { ctx: mctx, p: mp } = await session(phone(9), '/admin');
  await mp.goto(`${BASE}/admin/withdrawals`, { waitUntil: 'load' });
  check('4a the admin menu is a row of tabs, 44px+, and the page does not scroll sideways', (await small(mp, '[data-admin-nav] a')) === 0 && (await flat(mp)));
  await mp.locator('[data-admin-nav-item="/admin/orders"]').scrollIntoViewIfNeeded();
  await mp.locator('[data-admin-nav-item="/admin/orders"]').tap();
  await mp.waitForURL(/\/admin\/orders$/);
  check('4b a tab opens its page; «بازگشت» is a 44px target', (await small(mp, '[data-back]')) === 0 && (await mp.locator('[data-back]').count()) === 1);
  await mctx.close();

  // ── the sign-in's code box ──
  const gctx = await browser.newContext({ ...devices['iPhone 8'] });
  const gp = await gctx.newPage();
  await gp.goto(`${BASE}/login`, { waitUntil: 'load' });
  check('5a the sign-in has the optional code box, 44px+, without sideways scroll', (await gp.locator('main').getByLabel('کد معرف').count()) === 1 && (await small(gp, 'main input')) === 0 && (await flat(gp)));
  await gctx.close();
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
