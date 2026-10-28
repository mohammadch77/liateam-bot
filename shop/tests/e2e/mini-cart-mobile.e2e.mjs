// The mini-cart as a bottom sheet on WebKit phones (iPhone 8 and iPhone 13 profiles), by TAP: opened from the tab bar's
// cart, a dark backdrop and a handle, the lines scrolling inside the sheet, the page behind locked (and put back where it
// was), 44px controls, + / − / remove by tap with one total shared with /cart, the buttons in reach above the safe area,
// no sideways scroll, closing by the backdrop / the × / a new page. The cart is seeded in the database.
import { createHash, randomBytes } from 'node:crypto';
import {
  BASE,
  SCHEMA as S,
  check,
  devices,
  finish,
  requireLocalApp,
  sql,
  toLatin,
  webkit,
} from './_harness.mjs';

requireLocalApp();
const num = (t) => Number(toLatin(t));
const products = sql(
  `select string_agg(id::text, ',' order by id) from (select id from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 order by id limit 12) x`,
)
  .split(',')
  .map(Number);
if (products.length < 12) {
  console.error('need 12 in-stock products in the local DB');
  process.exit(2);
}
const hashes = [];
const seed = () => {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(`cart:${token}`).digest('hex');
  hashes.push(hash);
  sql(`with c as (insert into ${S}.carts (guest_token_hash) values ('${hash}') returning id)
       insert into ${S}.cart_items (cart_id, product_id, quantity) select c.id, x.p, 1 from c, (values ${products.map((p) => `(${p})`).join(',')}) as x(p)`);
  return token;
};

const browser = await webkit.launch();
try {
  for (const name of ['iPhone 8', 'iPhone 13']) {
    const ctx = await browser.newContext({ ...devices[name] });
    await ctx.addCookies([{ name: 'cart', value: seed(), url: BASE }]);
    const p = await ctx.newPage();
    const overflow = async () =>
      (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;
    await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
    await p.evaluate(() => window.scrollTo(0, 400));
    await p.waitForTimeout(300);
    const scrolled = await p.evaluate(() => window.scrollY);

    // ── open from the tab bar ──
    await p.locator('nav[aria-label="ناوبری اصلی"] [data-cart-tab]').tap();
    await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor({ timeout: 20000 });
    await p.waitForTimeout(600); // the sheet slides up (300ms): measure it at rest
    const geo = await p.evaluate(() => {
      const panel = document.querySelector('[data-mini-cart]').getBoundingClientRect();
      const backdrop = document.querySelector('[data-mini-backdrop]');
      const sc = document.querySelector('[data-mini-scroll]');
      return {
        bottom: panel.bottom,
        vh: window.innerHeight,
        height: panel.height,
        left: panel.left,
        right: panel.right,
        vw: window.innerWidth,
        backdrop: backdrop ? getComputedStyle(backdrop).backgroundColor : '',
        inner: sc.scrollHeight,
        client: sc.clientHeight,
        handle: getComputedStyle(document.querySelector('[data-mini-cart] > span')).display,
      };
    });
    check(
      `1a ${name}: a bottom sheet — full width, resting on the bottom of the screen`,
      Math.abs(geo.bottom - geo.vh) <= 1 && geo.left <= 1 && geo.right >= geo.vw - 1,
      JSON.stringify(geo),
    );
    check(
      `1b ${name}: dark backdrop and a handle`,
      /rgba\(30, 27, 36/.test(geo.backdrop) && geo.handle !== 'none',
    );
    check(
      `1c ${name}: it is not taller than 88% of the screen and the 12 lines scroll inside it`,
      geo.height <= geo.vh * 0.88 + 1 &&
        geo.inner > geo.client &&
        (await p.locator('[data-mini-line]').count()) === 12,
      `${geo.height} / ${geo.vh}; ${geo.inner} > ${geo.client}`,
    );
    check(`1d ${name}: no sideways scroll`, await overflow());

    // ── the page behind is locked and keeps its place ──
    const locked = await p.evaluate(() => ({
      position: getComputedStyle(document.body).position,
      top: document.body.style.top,
    }));
    check(
      `2a ${name}: the page behind is locked (it keeps its place: no jump)`,
      locked.position === 'fixed' && locked.top === `-${scrolled}px`,
      JSON.stringify(locked),
    );
    // the footer buttons are in reach (not under the tab bar or the home indicator) and tappable
    const foot = await p.evaluate(() => {
      const links = [...document.querySelectorAll('[data-mini-cart] footer a')];
      return links.map((a) => {
        const r = a.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          h: r.height,
          bottom: r.bottom,
          vh: window.innerHeight,
          reachable: a === hit || a.contains(hit),
        };
      });
    });
    check(
      `2b ${name}: «مشاهده سبد» and «ثبت سفارش» are on top (nothing covers them), 44px+, above the bottom edge`,
      foot.length === 2 && foot.every((f) => f.reachable && f.h >= 43.5 && f.bottom <= f.vh),
      JSON.stringify(foot),
    );
    const small = await p.evaluate(
      () =>
        [...document.querySelectorAll('[data-mini-cart] button, [data-mini-cart] footer a')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.height < 31.5 || r.width < 43.5);
        }).length,
    );
    check(
      `2c ${name}: every control in the sheet is at least 44px wide (and 32px+ high; the steppers 44)`,
      small === 0,
      `${small} too small`,
    );

    // ── + / − / remove by tap, one total with /cart ──
    const line = p.locator(`[data-mini-line="${products[0]}"]`);
    const total0 = num(await p.locator('[data-mini-total]').innerText());
    await line.getByRole('button', { name: 'زیاد کردن' }).tap();
    await p.waitForTimeout(1000);
    const total1 = num(await p.locator('[data-mini-total]').innerText());
    check(
      `3a ${name}: + by tap raises the quantity and the total`,
      num(await line.locator('[data-mini-qty]').innerText()) === 2 && total1 > total0,
    );
    await line.getByRole('button', { name: 'کم کردن' }).tap();
    await p.waitForTimeout(1000);
    check(
      `3b ${name}: − by tap lowers it again`,
      (await p.locator('[data-mini-total]').innerText()) !== '' &&
        num(await p.locator('[data-mini-total]').innerText()) === total0,
    );
    const last = p.locator(`[data-mini-line="${products[11]}"]`);
    await last.scrollIntoViewIfNeeded();
    await last.getByRole('button', { name: /حذف/ }).tap();
    await p.waitForFunction((id) => !document.querySelector(`[data-mini-line="${id}"]`), products[11]);
    await p.waitForTimeout(800);
    const miniTotal = num(await p.locator('[data-mini-total]').innerText());
    check(`3c ${name}: «حذف» by tap: 11 lines left`, (await p.locator('[data-mini-line]').count()) === 11);

    // ── closing: the page behind returns to where it was ──
    await p.locator('[data-mini-close]').tap();
    await p.waitForFunction(() => !document.querySelector('[data-mini-cart]'));
    const back = await p.evaluate(() => ({
      y: window.scrollY,
      position: getComputedStyle(document.body).position,
    }));
    check(
      `4a ${name}: closed by ×: the page is unlocked and at the same place`,
      back.position !== 'fixed' && Math.abs(back.y - scrolled) <= 1,
      JSON.stringify(back),
    );
    await p.locator('nav[aria-label="ناوبری اصلی"] [data-cart-tab]').tap();
    await p.locator('[data-mini-cart] [data-mini-line]').first().waitFor();
    await p.touchscreen.tap(20, 60); // the dark area above the sheet
    await p.waitForFunction(() => !document.querySelector('[data-mini-cart]'));
    check(`4b ${name}: a tap on the backdrop closes it`, true);

    // ── the cart page agrees ──
    await p.locator('nav[aria-label="ناوبری اصلی"] [data-cart-tab]').tap();
    await p.locator('[data-mini-cart] footer').getByRole('link', { name: 'مشاهده سبد' }).tap();
    await p.waitForURL(/\/cart$/);
    check(
      `5a ${name}: /cart opens, the sheet is closed, no sideways scroll`,
      (await p.locator('[data-mini-cart]').count()) === 0 && (await overflow()),
    );
    check(
      `5b ${name}: /cart has the same 11 lines and the same total as the sheet`,
      (await p.locator('[data-cart-line]').count()) === 11 &&
        num(await p.locator('[data-cart-total]').innerText()) === miniTotal,
    );
    await ctx.close();
  }
} finally {
  for (const h of hashes)
    sql(
      `delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where guest_token_hash = '${h}'); delete from ${S}.carts where guest_token_hash = '${h}'`,
    );
  await browser.close();
}
finish();
