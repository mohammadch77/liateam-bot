// The header mini-cart and its agreement with /cart (desktop): all 12 lines in the panel with their own scrolling (the page
// behind does not move), + / − / remove / the stock cap, one total everywhere (header number, mini-cart, /cart, in both
// directions and after the guest cart joins the account), the compact bar that keeps the cart icon on screen while the page
// scrolls, the panel staying under it, Escape / outside click / a new page closing it, and the optimistic change taken back
// when the server cannot be reached. The cart is seeded in the database (a guest cart with a cookie made here).
import { createHash, randomBytes } from 'node:crypto';
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

requireLocalApp();
const num = (t) => Number(toLatin(t));
const stamp = String(Date.now() % 1_000_000).padStart(6, '0');
const PHONE = `09993${stamp.slice(1)}0`.slice(0, 11);

const products = sql(
  `select string_agg(id || ':' || stock, ',' order by id) from (select id, stock from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 order by id limit 13) x`,
)
  .split(',')
  .map((r) => r.split(':').map(Number))
  .map(([id, stock]) => ({ id, stock }));
if (products.length < 13) {
  console.error('need 13 in-stock products in the local DB');
  process.exit(2);
}
const twelve = products.slice(0, 12);
const spare = products[12];
const small = twelve[3]; // its stock is lowered to 3 for the cap test
const smallStock = small.stock;

const seedGuest = (items) => {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(`cart:${token}`).digest('hex');
  sql(`with c as (insert into ${S}.carts (guest_token_hash) values ('${hash}') returning id)
       insert into ${S}.cart_items (cart_id, product_id, quantity) select c.id, x.p, x.q from c, (values ${items.map(([p, q]) => `(${p}, ${q})`).join(',')}) as x(p, q)`);
  return { token, hash };
};
const wipe = (hashes) => {
  for (const h of hashes)
    sql(
      `delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where guest_token_hash = '${h}'); delete from ${S}.carts where guest_token_hash = '${h}'`,
    );
  sql(
    `delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (select id from ${S}.users where phone = '${PHONE}')); delete from ${S}.carts where user_id in (select id from ${S}.users where phone = '${PHONE}')`,
  );
};

const hashes = [];
const browser = await chromium.launch();
const context = async (items) => {
  const seeded = seedGuest(items);
  hashes.push(seeded.hash);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'cart', value: seeded.token, url: BASE }]);
  return { ctx, page: await ctx.newPage() };
};
const miniTotal = async (p) => num(await p.locator('[data-mini-total]').innerText());
const headerCount = async (p) =>
  Number(await p.locator('[data-header-action="cart"]').first().getAttribute('data-cart-count'));
const open = async (p) => {
  await p.locator('[data-header-action="cart"]').first().click();
  await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor({ timeout: 20000 });
};
const settle = (p, ms = 900) => p.waitForTimeout(ms);

try {
  sql(`update supplier_products set stock = 3 where id = ${small.id}`);
  const items = twelve.map((p, i) => [p.id, i % 3 === 0 ? 2 : 1]);
  const expectedUnits = items.reduce((t, [, q]) => t + q, 0);
  const { ctx, page: p } = await context(items);

  // ── 1. all twelve lines, scrolling inside ──
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  check(
    '1a the header badge shows the seeded cart',
    (await headerCount(p)) === expectedUnits,
    `${await headerCount(p)} vs ${expectedUnits}`,
  );
  await open(p);
  check(
    '1b all 12 lines are in the mini-cart (no «و n کالای دیگر»)',
    (await p.locator('[data-mini-line]').count()) === 12 &&
      !/کالای دیگر/.test(await p.locator('[data-mini-cart]').innerText()),
  );
  const geo = await p.evaluate(() => {
    const panel = document.querySelector('[data-mini-cart]').getBoundingClientRect();
    const sc = document.querySelector('[data-mini-scroll]');
    return {
      h: panel.height,
      inner: sc.scrollHeight,
      client: sc.clientHeight,
      overscroll: getComputedStyle(sc).overscrollBehaviorY,
      overflowY: getComputedStyle(sc).overflowY,
    };
  });
  check(
    '1c the panel is at most min(70vh, 520px) high and the list scrolls inside it',
    geo.h <= 521 && geo.inner > geo.client && geo.overflowY === 'auto',
    JSON.stringify(geo),
  );
  check('1d overscroll-behavior: contain on the list', geo.overscroll === 'contain');
  check(
    '1e the total and the two buttons are in the footer',
    (await p.locator('[data-mini-cart] footer').getByRole('link', { name: 'مشاهده سبد' }).isVisible()) &&
      (await p.locator('[data-mini-cart] footer').getByRole('link', { name: 'ثبت سفارش' }).isVisible()),
  );

  // the list scrolls, the page behind does not
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.scrollTo(0, 300));
  await p.locator('[data-sticky-bar][data-shown="true"]').waitFor({ timeout: 10000 });
  await p.waitForTimeout(500);
  await p.locator('[data-header-action="cart-sticky"]').click(); // the header's own icon is out of view now (no scrolling back for it)
  await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor({ timeout: 20000 });
  const y0 = await p.evaluate(() => window.scrollY);
  check('1f-0 the page was scrolled down before the wheel test', y0 >= 250, String(y0));
  const box = await p.locator('[data-mini-scroll]').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(0, 2000);
  await p.mouse.wheel(0, 2000); // past the end of the list: must not chain to the page
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({
    y: window.scrollY,
    top: document.querySelector('[data-mini-scroll]').scrollTop,
  }));
  check(
    '1f wheel over the list: it scrolls, the page does not',
    after.top > 0 && after.y === y0,
    `${JSON.stringify(after)} vs ${y0}`,
  );
  await p.keyboard.press('Escape');

  // ── 2. + / − / remove / cap: the mini-cart and /cart keep one total ──
  await open(p);
  const first = p.locator(`[data-mini-line="${twelve[0].id}"]`);
  const t0 = await miniTotal(p);
  await first.getByRole('button', { name: 'زیاد کردن' }).click();
  await settle(p);
  const t1 = await miniTotal(p);
  check(
    '2a + raises the quantity and the total at once',
    num(await first.locator('[data-mini-qty]').innerText()) === 3 && t1 > t0,
    `${t0} → ${t1}`,
  );
  check('2b the header badge follows', (await headerCount(p)) === expectedUnits + 1);
  await first.getByRole('button', { name: 'کم کردن' }).click();
  await settle(p);
  check('2c − lowers it back', (await miniTotal(p)) === t0 && (await headerCount(p)) === expectedUnits);
  const one = p.locator(`[data-mini-line="${twelve[1].id}"]`); // quantity 1: − is off (the × removes)
  check(
    '2d at quantity 1 the − button is disabled',
    await one.getByRole('button', { name: 'کم کردن' }).isDisabled(),
  );

  // the stock cap (that product has 3 left)
  const capLine = p.locator(`[data-mini-line="${small.id}"]`);
  await capLine.scrollIntoViewIfNeeded();
  const plus = capLine.getByRole('button', { name: 'زیاد کردن' });
  for (let i = 0; i < 4 && (await plus.isEnabled()); i++) {
    await plus.click();
    await settle(p, 700);
  }
  check(
    '2e at the stock the + is off and «حداکثر موجودی» is shown',
    (await plus.isDisabled()) &&
      num(await capLine.locator('[data-mini-qty]').innerText()) === 3 &&
      /حداکثر موجودی/.test(await capLine.innerText()),
  );

  // remove a line
  const unitsBefore = await headerCount(p);
  const gone = twelve[2];
  const goneQty = num(await p.locator(`[data-mini-line="${gone.id}"] [data-mini-qty]`).innerText());
  await p.locator(`[data-mini-line="${gone.id}"]`).getByRole('button', { name: /حذف/ }).click();
  await p.waitForFunction((id) => !document.querySelector(`[data-mini-line="${id}"]`), gone.id);
  await settle(p);
  check(
    '2f «حذف» takes the line out; the badge and the lines follow',
    (await p.locator('[data-mini-line]').count()) === 11 && (await headerCount(p)) === unitsBefore - goneQty,
  );

  // ── 3. /cart shows exactly the same cart ──
  const miniNow = await miniTotal(p);
  const lineQty = {};
  for (const l of await p.locator('[data-mini-line]').all())
    lineQty[await l.getAttribute('data-mini-line')] = num(await l.locator('[data-mini-qty]').innerText());
  await p.locator('[data-mini-cart] footer').getByRole('link', { name: 'مشاهده سبد' }).click();
  await p.waitForURL(/\/cart$/);
  check('3a the panel closes when the page changes', (await p.locator('[data-mini-cart]').count()) === 0);
  const cartQty = {};
  for (const l of await p.locator('[data-cart-line]').all())
    cartQty[await l.getAttribute('data-cart-line')] = num(await l.locator('[data-line-qty]').innerText());
  check(
    '3b /cart: same lines and quantities as the mini-cart (the one that was wrong before)',
    JSON.stringify(Object.entries(cartQty).sort()) === JSON.stringify(Object.entries(lineQty).sort()),
    `${Object.keys(cartQty).length} / ${Object.keys(lineQty).length}`,
  );
  check('3c /cart: the same total', num(await p.locator('[data-cart-total]').innerText()) === miniNow);

  // a change on /cart is in the mini-cart at once, and the badge follows
  const cl = p.locator(`[data-cart-line="${twelve[4].id}"]`);
  const q4 = num(await cl.locator('[data-line-qty]').innerText());
  await cl.getByRole('button', { name: 'زیاد کردن' }).click();
  await settle(p, 1200);
  const cartTotal = num(await p.locator('[data-cart-total]').innerText());
  await open(p);
  check(
    '3d a change on /cart is in the mini-cart straight away (quantity and total)',
    num(await p.locator(`[data-mini-line="${twelve[4].id}"] [data-mini-qty]`).innerText()) === q4 + 1 &&
      (await miniTotal(p)) === cartTotal,
  );
  // and the other way round: a change in the panel is on the page without a reload
  await p.locator(`[data-mini-line="${twelve[4].id}"]`).getByRole('button', { name: 'کم کردن' }).click();
  await settle(p, 1200);
  check(
    '3e a change in the mini-cart shows on /cart',
    num(await p.locator(`[data-cart-line="${twelve[4].id}"] [data-line-qty]`).innerText()) === q4 &&
      num(await p.locator('[data-cart-total]').innerText()) === (await miniTotal(p)),
  );
  await p.keyboard.press('Escape');

  // ── 4. the cart icon stays on screen; the panel stays under it ──
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  check(
    '4a at the top the compact bar is hidden',
    (await p.locator('[data-sticky-bar]').getAttribute('data-shown')) === 'false',
  );
  await p.evaluate(() => window.scrollTo(0, 1500));
  await p.locator('[data-sticky-bar][data-shown="true"]').waitFor({ timeout: 10000 });
  await p.waitForTimeout(500); // the bar slides in
  const stickyIcon = p.locator('[data-header-action="cart-sticky"]');
  const sb = await stickyIcon.boundingBox();
  check(
    '4b scrolled down: the compact bar shows the cart icon and its number',
    !!sb &&
      sb.y >= 0 &&
      sb.y < 80 &&
      (await stickyIcon.getAttribute('data-cart-count')) === String(await headerCount(p)),
    JSON.stringify(sb),
  );
  await stickyIcon.click();
  await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor({ timeout: 20000 });
  const pb = await p.locator('[data-mini-cart]').boundingBox();
  check(
    "4c the panel hangs under the compact bar's icon",
    pb.y >= sb.y + sb.height - 2 && pb.y < sb.y + sb.height + 40,
    `${pb.y} vs ${sb.y + sb.height}`,
  );
  await p.mouse.wheel(0, 600); // over the page, outside the panel
  await p.waitForTimeout(500);
  const pb2 = await p.locator('[data-mini-cart]').boundingBox();
  check(
    '4d scrolling the page: the panel stays where it is',
    Math.abs(pb2.y - pb.y) <= 1 && Math.abs(pb2.x - pb.x) <= 1,
    `${pb.y} → ${pb2.y}`,
  );
  await p.mouse.click(300, 600); // outside
  await p.waitForFunction(() => !document.querySelector('[data-mini-cart]'));
  check('4e a click outside closes it', true);
  await open(p).catch(async () => {
    await p.locator('[data-header-action="cart-sticky"]').click();
    await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor();
  });
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('[data-mini-cart]'));
  check(
    '4f Escape closes it (and the focus is back on the icon)',
    (await p.evaluate(() => document.activeElement?.getAttribute('data-header-action'))) !== null,
  );

  // from the top of the page the panel hangs under the header's icon and follows it while the page scrolls up
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  await p.locator('[data-header-action="cart"]').first().click();
  await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor();
  const hb = await p.locator('[data-header-action="cart"]').first().boundingBox();
  const mb = await p.locator('[data-mini-cart]').boundingBox();
  check(
    '4g at the top: the panel is right under the header icon',
    mb.y >= hb.y + hb.height - 2 && mb.y < hb.y + hb.height + 30,
    `${mb.y} vs ${hb.y + hb.height}`,
  );
  await p.keyboard.press('Escape');

  // ── 5. a change that cannot reach the server is taken back, with a message ──
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await open(p);
  const target = p.locator(`[data-mini-line="${twelve[5].id}"]`);
  const qBefore = num(await target.locator('[data-mini-qty]').innerText());
  const totalBefore = await miniTotal(p);
  await p.route('**/*', (route) =>
    route.request().headers()['next-action'] ? route.abort() : route.continue(),
  );
  await target.getByRole('button', { name: 'زیاد کردن' }).click();
  await p.locator('[data-cart-toast="error"]').waitFor({ timeout: 15000 });
  await p.unroute('**/*');
  await settle(p, 600);
  check(
    '5 the server cannot be reached: the quantity and total go back, an error is shown',
    num(await target.locator('[data-mini-qty]').innerText()) === qBefore &&
      (await miniTotal(p)) === totalBefore,
  );
  await p.keyboard.press('Escape');
  await ctx.close();

  // ── 6. after sign-in: the guest cart joined the account's, and the mini-cart and /cart agree ──
  const g = await context([
    [twelve[0].id, 1],
    [spare.id, 2],
  ]);
  sql(`insert into ${S}.users (phone) values ('${PHONE}') on conflict do nothing`);
  sql(`with c as (insert into ${S}.carts (user_id) select id from ${S}.users where phone = '${PHONE}' returning id)
       insert into ${S}.cart_items (cart_id, product_id, quantity) select c.id, x.p, x.q from c, (values (${twelve[0].id}, 1), (${twelve[1].id}, 1)) as x(p, q)`);
  await signIn(g.page, PHONE);
  await g.page.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await open(g.page);
  const afterLogin = {};
  for (const l of await g.page.locator('[data-mini-line]').all())
    afterLogin[await l.getAttribute('data-mini-line')] = num(await l.locator('[data-mini-qty]').innerText());
  check(
    '6a the merged cart: the same product adds up (1 + 1), the others are all there',
    afterLogin[twelve[0].id] === 2 &&
      afterLogin[twelve[1].id] === 1 &&
      afterLogin[spare.id] === 2 &&
      Object.keys(afterLogin).length === 3,
    JSON.stringify(afterLogin),
  );
  const merged = await miniTotal(g.page);
  await g.page.goto(`${BASE}/cart`, { waitUntil: 'load' });
  check(
    '6b /cart agrees with the mini-cart after the merge',
    num(await g.page.locator('[data-cart-total]').innerText()) === merged &&
      (await g.page.locator('[data-cart-line]').count()) === 3,
  );
  check('6c the header badge agrees', (await headerCount(g.page)) === 5);
  await g.ctx.close();
} finally {
  sql(`update supplier_products set stock = ${smallStock} where id = ${small.id}`);
  wipe(hashes);
  await browser.close();
}
finish();
void sleep;
