// Favourites and the panels' navigation (task K, C): the heart on a card and on the product page (a guest goes to the sign-in and comes
// back; on, off, on again keeps ONE row with removed_at, nothing is deleted); the public pages stay the same for everyone (the heart's
// state is read after the page has loaded, never rendered into it); /account/favorites (the list from the catalog's own logic, add to
// the cart, remove, only one's own list); the admin panel's menu with the numbers of what waits (admin: all, support: orders only, a
// customer: 403); and the «بازگشت» link (history when the previous page is ours, else the parent; not on the panel's root; 44px).
// Invented numbers, new for every run.
import { BASE, SCHEMA as S, check, chromium, finish, requireLocalApp, signIn, sql } from './_harness.mjs';
import { NET, makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { seeder } from './_seed-order.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09996', stamp);
const PHONES = `select phone from ${S}.users where phone like '09996%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.favorites where user_id in (${UIDS});
    delete from ${S}.site_reviews where user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});`);

const rows = sql(
  `select string_agg(id || ':' || coalesce(slug_en, ''), ',' order by id) from (select id, slug_en from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 and slug_en is not null order by id limit 2) x`,
).split(',').map((r) => r.split(':'));
const [[p1, s1], [p2]] = rows;
const out = sql(`select id from product_catalog where is_sellable and price > 0 and missing_since is null and stock = 0 order by id limit 1`);

const browser = await chromium.launch();
let ipn = 0;
const newCtx = (viewport = { width: 1280, height: 900 }) => browser.newContext({ viewport, extraHTTPHeaders: { 'x-real-ip': `10.${NET}.${120 + ++ipn}.1` } });
const favRows = (u, id) => sql(`select count(*) || ':' || count(*) filter (where removed_at is null) from ${S}.favorites where user_id = ${u.id} and product_id = ${id}`);
const until = async (fn) => {
  for (let i = 0; i < 40; i++) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
};
const px = (loc) => loc.evaluate((e) => Math.round(e.getBoundingClientRect().height));

try {
  wipe();
  const F = makeUser(1);
  const G = makeUser(2);

  // ── 1. a guest's heart goes to the sign-in and back ──
  const gctx = await newCtx();
  const gp = await gctx.newPage();
  await gp.goto(`${BASE}/shop`, { waitUntil: 'load' });
  const firstHeart = gp.locator('main article [data-favorite]').first();
  await firstHeart.waitFor();
  check('1a the heart on a card is a real 44px button', (await px(firstHeart)) >= 44);
  await firstHeart.click();
  await gp.waitForURL(/\/login\?next=%2Fshop/, { timeout: 15000 });
  check('1b a guest\'s click goes to the sign-in with a way back to the same page', true);

  // ── 2. the product page: on, off, on again ──
  const ctx = await newCtx();
  const p = await ctx.newPage();
  await signIn(p, F.phone);
  await p.goto(`${BASE}/shop/product/${s1}`, { waitUntil: 'load' });
  const heart = p.locator(`[data-favorite][data-product="${p1}"]`).first();
  await heart.waitFor();
  check('2a the product page has the heart, off at first', (await heart.getAttribute('data-favorite')) === 'off');
  await heart.click();
  await p.waitForFunction((id) => document.querySelector(`[data-favorite][data-product="${id}"]`)?.getAttribute('data-favorite') === 'on', p1, { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('[data-cart-toast]'), null, { timeout: 15000 }).catch(() => {});
  check('2b a click turns it on at once and saves one row', favRows(F, p1) === '1:1', `${favRows(F, p1)} ${await p.locator('[data-cart-toast]').innerText().catch(() => 'no toast')}`);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction((id) => document.querySelector(`[data-favorite][data-product="${id}"]`)?.getAttribute('data-favorite') === 'on', p1, { timeout: 15000 });
  check('2c after a reload the heart is on again (read by a light request after the page loaded)', true);
  const html = await (await ctx.request.get(`${BASE}/shop/product/${s1}`)).text();
  check('2d …but the page itself carries nothing personal: the server rendered it «off» (so public pages stay cacheable)', /data-favorite="off"[^>]*data-product="/.test(html) && !/data-favorite="on"/.test(html));
  await heart.click();
  await p.waitForFunction((id) => document.querySelector(`[data-favorite][data-product="${id}"]`)?.getAttribute('data-favorite') === 'off', p1, { timeout: 15000 });
  check('2e off again: the row stays, soft-removed (the app cannot DELETE)', await until(() => favRows(F, p1) === '1:0'), favRows(F, p1));
  await heart.click();
  await p.waitForFunction((id) => document.querySelector(`[data-favorite][data-product="${id}"]`)?.getAttribute('data-favorite') === 'on', p1, { timeout: 15000 });
  check('2f on once more: still ONE row (unique per user and product), live again', await until(() => favRows(F, p1) === '1:1'), favRows(F, p1));

  // ── 3. the list ──
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  const card2 = p.locator(`main article [data-favorite][data-product="${p2}"]`);
  if ((await card2.count()) === 0) await p.goto(`${BASE}/shop/product/${rows[1][1]}`, { waitUntil: 'load' });
  await p.locator(`[data-favorite][data-product="${p2}"]`).first().click();
  await p.waitForFunction((id) => document.querySelector(`[data-favorite][data-product="${id}"]`)?.getAttribute('data-favorite') === 'on', p2, { timeout: 15000 });
  await until(() => favRows(F, p2) === '1:1');
  if (out) sql(`insert into ${S}.favorites (user_id, product_id) values (${F.id}, ${out}) on conflict do nothing`);
  await p.goto(`${BASE}/account/favorites`, { waitUntil: 'load' });
  check('3a the list shows the favourite products as cards, newest first', (await p.locator('[data-favorite-item]').count()) >= 2 && (await p.locator('[data-favorite-item]').first().getAttribute('data-favorite-item')) === (out ? out : p2));
  if (out) check('3b an out-of-stock favourite carries its message', (await p.locator(`[data-favorite-item="${out}"] [data-favorite-out]`).count()) === 1);
  const cartBefore = await p.locator('[data-header-action="cart"]').first().getAttribute('data-cart-count');
  await p.locator(`[data-favorite-item="${p2}"] [data-cart-add]`).click();
  await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 15000 });
  check('3c «افزودن به سبد» works from the list (the badge goes up)', (await p.locator('[data-header-action="cart"]').first().getAttribute('data-cart-count')) !== cartBefore);
  await p.locator(`[data-favorite-item="${p2}"] [data-favorite-remove]`).click();
  await p.waitForFunction((id) => !document.querySelector(`[data-favorite-item="${id}"]`), p2, { timeout: 15000 });
  check('3d «حذف از لیست» takes it off (soft: the row is kept with removed_at)', await until(() => favRows(F, p2) === '1:0'), favRows(F, p2));
  const gctx2 = await newCtx();
  const g2 = await gctx2.newPage();
  await signIn(g2, G.phone);
  await g2.goto(`${BASE}/account/favorites`, { waitUntil: 'load' });
  check('3e another customer\'s list is their own (empty), never F\'s', (await g2.locator('[data-favorite-item]').count()) === 0);
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  const redirect = await ap.goto(`${BASE}/account/favorites`);
  check('3f a guest at /account/favorites is sent to the sign-in', /\/login\?next=/.test(ap.url()) && redirect?.ok() === true);

  // ── 4. the admin panel's menu ──
  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  const sup = makeUser(5);
  sql(`insert into ${S}.user_roles (user_id, role) values (${sup.id}, 'support')`);
  sql(`insert into ${S}.site_reviews (product_id, user_id, author_name, rating, body, status) values (${p1}, ${F.id}, 'آزمون', 5, 'دیدگاه آزمایشی برای شمارنده‌ی منو', 'pending')`);
  const actx = await newCtx();
  const adm = await actx.newPage();
  await adminSignIn(adm, adminPhone, '/admin');
  await adm.goto(`${BASE}/admin/withdrawals`);
  check('4a the admin panel has its side menu on every page, the current one marked', (await adm.locator('[data-admin-nav] a').count()) === 11 && (await adm.locator('[data-admin-nav] a[aria-current="page"]').getAttribute('data-admin-nav-item')) === '/admin/withdrawals');
  check('4b a pending review shows its number on «دیدگاه‌ها»', (await adm.locator('[data-admin-nav-item="/admin/reviews"] [data-nav-count]').count()) === 1);
  check('4c the menu items are 44px high', (await px(adm.locator('[data-admin-nav] a').first())) >= 44);
  const sctx = await newCtx();
  const spg = await sctx.newPage();
  await adminSignIn(spg, sup.phone, '/admin/orders');
  await spg.goto(`${BASE}/admin/orders`);
  check('4d support sees the orders in the menu and nothing else', (await spg.locator('[data-admin-nav] a').count()) === 1 && (await spg.locator('[data-admin-nav-item="/admin/orders"]').count()) === 1);
  const denied = await g2.goto(`${BASE}/admin/orders`);
  check('4e a customer: 403 and no menu', denied?.status() === 403 && (await g2.locator('[data-admin-nav]').count()) === 0);

  // ── 5. «بازگشت» ──
  await p.goto(`${BASE}/account`, { waitUntil: 'load' });
  check('5a the panel\'s root has no back link', (await p.locator('[data-back]').count()) === 0);
  await p.locator('[data-account-nav] a[href="/account/wallet"]').click();
  await p.waitForURL(/\/account\/wallet$/);
  const back = p.locator('[data-back]');
  check('5b a page of the panel has «بازگشت», 44px high and a real link', (await back.count()) === 1 && (await px(back)) >= 44 && (await back.getAttribute('href')) === '/account');
  await back.click();
  await p.waitForURL(/\/account$/);
  check('5c it goes back in the history to where the customer came from', true);
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  // a navigation made by the page itself carries it as the referrer (a plain goto has none)
  await Promise.all([
    p.waitForURL(/\/account\/orders$/),
    p.evaluate((to) => window.location.assign(to), '/account/orders'),
  ]);
  await p.locator('[data-back]').click();
  await p.waitForURL(/\/shop$/);
  check('5d …whichever site page that was (here the shop)', true);
  const fresh = await ctx.newPage(); // no history of ours behind it: the parent page
  await fresh.goto(`${BASE}/account/wallet`, { waitUntil: 'load' });
  await fresh.locator('[data-back]').click();
  await fresh.waitForURL(/\/account$/);
  check('5e with no earlier page of ours it goes to the parent', true);
  await adm.goto(`${BASE}/admin/orders`, { waitUntil: 'load' });
  check('5f the admin panel has it too (to the parent: the dashboard)', (await adm.locator('[data-back]').getAttribute('href')) === '/admin');
  await adm.goto(`${BASE}/admin`, { waitUntil: 'load' });
  check('5g and not on the admin root', (await adm.locator('[data-back]').count()) === 0);
} finally {
  wipe();
  await browser.close();
}
finish();
