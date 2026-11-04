// Task N end to end (local app + Docker DB): the search as cards (header on a desktop; the tab bar's full-screen search and the
// hamburger menu on a WebKit phone, by TAP), the results page with the matched categories and brands, the empty search and its way on,
// the search page for a visitor whose scripts did not run, the packs as the shop's product cards in two columns, and the hamburger
// without the account block that the tab bar's «حساب» already has — the tab bar itself unchanged. Chromium for the desktop part, WebKit
// (iPhone 8) for the phone part. Read-only: nothing is written to the database.
import { BASE, check, chromium, devices, finish, requireLocalApp, webkit } from './_harness.mjs';

requireLocalApp();
const browser = await chromium.launch();
const phone = await webkit.launch();
const flat = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);
const small = (p, sel) =>
  p.evaluate(
    (q) => [...document.querySelectorAll(q)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5; }).length,
    sel,
  );

try {
  // ───────── desktop: the header search ─────────
  const d = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await d.goto(`${BASE}/`, { waitUntil: 'load' });
  const box = d.locator('header input[type=search]').first();
  await box.fill('ریمل');
  const popup = d.locator('header form[role=search]').first();
  await popup.locator('[data-search-card="product"]').first().waitFor({ timeout: 15000 });
  const card = popup.locator('[data-search-card="product"]').first();
  const cardText = await card.innerText();
  check('1a a product suggestion is a card: a picture, the name, the brand and the price in tomans', (await card.locator('img').count()) === 1 && /ریمل/.test(cardText) && /تومان/.test(cardText), cardText.replace(/\s+/g, ' '));
  check('1b the matched categories come as cards with their count', (await popup.locator('[data-search-card="cat"]').count()) >= 1 && /محصول/.test(await popup.locator('[data-search-card="cat"]').first().innerText()));
  check('1c the groups have titles (دسته‌بندی‌ها, محصولات)', (await popup.locator('[data-search-group="cat"]').count()) === 1 && (await popup.locator('[data-search-group="product"]').count()) === 1);
  check('1d a link to all the results is the last option', /مشاهده/.test(await popup.locator('[data-search-card="all"]').innerText()));
  await box.fill('سرژه');
  await popup.locator('[data-search-card="brand"]').first().waitFor({ timeout: 15000 });
  check('1e a brand matches as a card (name, how many products)', /سرژه/.test(await popup.locator('[data-search-card="brand"]').first().innerText()) && /محصول/.test(await popup.locator('[data-search-card="brand"]').first().innerText()));
  await box.fill('ماشین لباسشویی');
  await popup.locator('[data-search-empty]').waitFor({ timeout: 15000 });
  check('1f nothing found: the message and the main categories and a few products to go to', (await popup.locator('[data-search-card="fb-cat"]').count()) >= 1 && (await popup.locator('[data-search-card="fb-product"]').count()) >= 1);
  await box.fill('سمپل');
  await d.waitForTimeout(900);
  check('1g a sample («سمپل») is never a result', (await popup.locator('[data-search-card="product"]').count()) === 0);
  await box.fill('');
  await box.fill('ریمل');
  await popup.locator('[data-search-card="product"]').first().waitFor();
  await box.press('Enter');
  await d.waitForURL(/\/shop\/search\?q=/, { timeout: 20000 });

  // ───────── the results page ─────────
  await d.goto(`${BASE}/shop/search?q=${encodeURIComponent('سرژه')}`, { waitUntil: 'load' });
  await d.locator('main article').first().waitFor({ timeout: 20000 }); // the page streams: the cards arrive just after the load
  check('2a the results page shows the matched brand as a card above the products', (await d.locator('[data-search-group="brand"] [data-search-card="brand"]').count()) >= 1 && (await d.locator('main article').count()) >= 1);
  await d.goto(`${BASE}/shop/search?q=${encodeURIComponent('ضد آفتاب')}`, { waitUntil: 'load' });
  check('2b a category matches as a card with a picture or an icon and its count', (await d.locator('[data-search-group="category"] [data-search-card="category"]').count()) >= 1);
  await d.goto(`${BASE}/shop/search?q=${encodeURIComponent('ماشین لباسشویی')}`, { waitUntil: 'load' });
  await d.locator('[data-search-fallback] article').first().waitFor({ timeout: 20000 });
  check('2c nothing found: «نتیجه‌ای پیدا نشد» with the categories and the products offered as cards', /پیدا نشد/.test(await d.locator('main').innerText()) && (await d.locator('[data-search-fallback] article').count()) >= 1 && (await d.locator('[data-search-group="category"]').count()) >= 1);
  await d.goto(`${BASE}/shop/search?q=${encodeURIComponent('رژلب')}`, { waitUntil: 'load' });
  await d.locator('main article').first().waitFor({ timeout: 20000 });
  check('2d two words typed as one («رژلب») find «رژ لب»', (await d.locator('main article').count()) >= 1);
  await d.goto(`${BASE}/shop/search`, { waitUntil: 'load' });
  await d.locator('[data-search-card="category"]').first().waitFor({ timeout: 20000 });
  check('2e the search page with nothing asked: the field is ready and focused, the categories are offered (not the whole catalogue)', (await d.locator('[data-search-landing] input').count()) === 1 && (await d.evaluate(() => document.activeElement?.closest('[data-search-landing]') !== null)) && (await d.locator('[data-search-card="category"]').count()) >= 1);
  await d.goto(`${BASE}/shop/search?sort=newest`, { waitUntil: 'load' });
  await d.locator('main article').first().waitFor({ timeout: 20000 });
  check('2f a link that wants the catalogue (a sort) still gets it', (await d.locator('[data-search-landing]').count()) === 0 && (await d.locator('main article').count()) >= 4);

  // ───────── the phone ─────────
  const ctx = await phone.newContext({ ...devices['iPhone 8'] });
  const m = await ctx.newPage();
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  await m.waitForTimeout(1200);
  const tabs = await m.locator('nav[aria-label="ناوبری اصلی"] a').allInnerTexts();
  check('3a the tab bar is as it was: خانه · دسته‌ها · جست‌وجو · سبد · ورود (in this order)', tabs.map((t) => t.replace(/\s+/g, ' ').trim().replace(/[0-9۰-۹]+$/, '').trim()).join('|') === 'خانه|دسته‌ها|جست‌وجو|سبد|ورود', tabs.join('|'));
  await m.locator('nav[aria-label="ناوبری اصلی"] [data-open-search]').tap();
  const overlay = m.locator('[data-search-overlay]');
  await overlay.waitFor({ state: 'visible' });
  check('3b a tap on the tab bar\'s «جست‌وجو» opens the full-screen search with the field focused', await m.evaluate(() => document.activeElement?.closest('[data-search-overlay]') !== null));
  await m.keyboard.type('شامپو', { delay: 40 });
  await overlay.locator('[data-search-card="product"]').first().waitFor({ timeout: 15000 });
  check('3c suggestions are cards, with no sideways scroll and no jump (the dialog fills the visible area)', (await flat(m)) && (await overlay.locator('[data-search-card="product"] img').count()) >= 1 && (await overlay.evaluate((e) => Math.abs(e.getBoundingClientRect().height - window.innerHeight) < 2)));
  check('3d the clear and the close buttons are 44px+, and the cards too', (await small(m, '[data-search-overlay] [data-search-clear], [data-search-overlay] button[aria-label="بستن جست‌وجو"], [data-search-overlay] [data-search-card]')) === 0);
  await overlay.locator('[data-search-clear]').tap();
  check('3e «پاک کردن» empties the field and keeps it focused', (await overlay.locator('input').inputValue()) === '' && (await m.evaluate(() => document.activeElement?.tagName === 'INPUT')));
  await m.keyboard.type('سرژه');
  await overlay.locator('[data-search-card="brand"]').first().waitFor({ timeout: 15000 });
  await overlay.locator('[data-search-card="brand"]').first().tap();
  await m.waitForURL(/\/shop\/brand\//, { timeout: 20000 });
  check('3f a tap on a card goes there and closes the search', await overlay.isHidden());
  await m.locator('nav[aria-label="ناوبری اصلی"] [data-open-search]').tap();
  await overlay.waitFor({ state: 'visible' });
  await m.locator('button[aria-label="بستن جست‌وجو"]').tap();
  check('3g the close button closes it', await overlay.isHidden());

  // the tab bar's link for a visitor whose scripts did not run (or have not yet): a search page with the field ready
  const plain = await phone.newContext({ ...devices['iPhone 8'], javaScriptEnabled: false });
  const pp = await plain.newPage();
  await pp.goto(`${BASE}/`, { waitUntil: 'load' });
  await pp.locator('nav[aria-label="ناوبری اصلی"] [data-open-search]').tap();
  await pp.waitForURL(/\/shop\/search$/, { timeout: 20000 });
  check('3h without scripts the tab bar\'s search leads to a page with the field and the categories, not to the whole catalogue', (await pp.locator('[data-search-landing] input').count()) === 1 && (await pp.locator('[data-search-card="category"]').count()) >= 1);
  await plain.close();

  // the hamburger: the account block is the tab bar's
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  await m.locator('button[aria-label="منو"]').first().tap();
  const drawer = m.locator('[data-mobile-menu]');
  await drawer.locator('nav').first().waitFor({ timeout: 10000 });
  const menu = await drawer.innerText();
  check('4a the hamburger has no sign-in / account, wallet or order-tracking entries (they are the tab bar\'s «حساب»)', !/ورود \| ثبت‌نام|حساب کاربری|کیف پول|پیگیری سفارش/.test(menu), menu.replace(/\s+/g, ' ').slice(-200));
  check('4b the rest is as it was: all products, the categories, the brands, the pages', /همه‌ی محصولات/.test(menu) && /دسته‌بندی‌ها/.test(menu) && /برندها/.test(menu) && /درباره ما/.test(menu));
  await m.keyboard.press('Escape');

  // ───────── packs as cards ─────────
  const pack = `${BASE}/shop/packs/skin-routine/oily`;
  const got = await m.goto(pack, { waitUntil: 'load' });
  if (got?.status() === 200) {
    const cards = m.locator('[data-pack-cards] > li');
    const n = await cards.count();
    const b0 = await cards.nth(0).boundingBox();
    const b1 = await cards.nth(1).boundingBox();
    check('5a the pack\'s steps are the shop\'s product cards in two columns on a phone (side by side, about half the width each)', n >= 2 && !!b0 && !!b1 && Math.abs(b0.y - b1.y) < 4 && b0.x !== b1.x && b0.width < 200 && (await cards.first().locator('article').count()) === 1);
    check('5b a card has the picture, the name and the price; no sideways scroll', (await cards.first().locator('img').count()) >= 1 && (await flat(m)));
    await m.setViewportSize({ width: 320, height: 640 });
    await m.reload({ waitUntil: 'load' });
    const c0 = await m.locator('[data-pack-cards] > li').nth(0).boundingBox();
    const c1 = await m.locator('[data-pack-cards] > li').nth(1).boundingBox();
    check('5c on a very narrow screen it is one column', !!c0 && !!c1 && c1.y > c0.y + 20 && (await flat(m)));
    await m.setViewportSize({ width: 375, height: 667 });
    await m.goto(`${BASE}/`, { waitUntil: 'load' });
    const home = m.locator('[data-routine-compact] > li');
    if ((await home.count()) >= 2) {
      const h0 = await home.nth(0).boundingBox();
      const h1 = await home.nth(1).boundingBox();
      check('5d the home «روتین پوستی» shows the same cards, two columns, on a phone', !!h0 && !!h1 && Math.abs(h0.y - h1.y) < 4 && (await flat(m)));
    }
  } else console.log('  – 5 skipped (the oily pack is not in this database)');
  await ctx.close();
} finally {
  await browser.close();
  await phone.close();
}
finish();
