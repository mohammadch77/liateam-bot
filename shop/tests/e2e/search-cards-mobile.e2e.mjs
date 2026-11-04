// Task N2, on a WebKit phone (iPhone 8), by TAP: a search answers with PRODUCT cards (picture, whole name, price) — in the live suggestions and
// on the results page — with the matched categories and brands only as small chips above them; «همه‌ی محصولات» and three categories are
// all product cards, two columns, and no card is without a picture or the placeholder (a picture that cannot load becomes the placeholder).
import { BASE, check, finish, requireLocalApp, webkit, devices } from './_harness.mjs';

requireLocalApp();
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 8'] });
const p = await ctx.newPage();
const flat = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 1);
/** every product card on the page has a picture or the placeholder, a name and a price (or «ناموجود») */
const cardsOk = () =>
  p.evaluate(() => {
    const cards = [...document.querySelectorAll('main article')];
    const bad = cards.filter((a) => !(a.querySelector('[data-card-image]') || a.querySelector('[data-card-placeholder]')) || !/تومان|ناموجود/.test(a.textContent ?? '') || !(a.querySelector('h3')?.textContent ?? '').trim());
    return { n: cards.length, bad: bad.length };
  });
const articles = () => p.locator('main article').first().waitFor({ timeout: 25000 });

try {
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  for (const q of ['سرم', 'شامپو']) {
    await p.locator('nav[aria-label="ناوبری اصلی"] [data-open-search]').tap();
    const overlay = p.locator('[data-search-overlay]');
    await overlay.waitFor({ state: 'visible' });
    await p.keyboard.type(q, { delay: 60 });
    await overlay.locator('[data-search-card="product"]').first().waitFor({ timeout: 15000 });
    const info = await overlay.evaluate((o) => {
      const cards = [...o.querySelectorAll('[data-search-card="product"]')];
      const chips = [...o.querySelectorAll('[data-search-card="cat"], [data-search-card="brand"]')];
      return {
        n: cards.length,
        full: cards.every((c) => (c.querySelector('img') || c.querySelector('svg')) && /تومان|ناموجود/.test(c.textContent ?? '') && (c.textContent ?? '').trim().length > 12),
        firstTop: Math.round(cards[0].getBoundingClientRect().top),
        chipMax: Math.max(0, ...chips.map((c) => c.getBoundingClientRect().height)),
        chipMin: Math.min(99, ...chips.map((c) => c.getBoundingClientRect().height)),
        chips: chips.length,
        vh: innerHeight,
      };
    });
    check(`«${q}»: live suggestions are product cards (a picture, the name, the price) — ${info.n} of them`, info.n >= 3 && info.full, JSON.stringify(info));
    check(`«${q}»: categories and brands are small chips (≥44px, ≤56px), and the first product is on screen without scrolling`, info.chips === 0 || (info.chipMin >= 43.5 && info.chipMax <= 56), JSON.stringify(info));
    check(`«${q}»: the first product card starts in the upper part of the screen`, info.firstTop < info.vh * 0.6, JSON.stringify(info));
    await p.keyboard.press('Enter');
    await p.waitForURL(/\/shop\/search\?q=/, { timeout: 20000 });
    await articles();
    const r = await cardsOk();
    check(`«${q}»: the results page is product cards, each with a picture or the placeholder, a name and a price`, r.n >= 3 && r.bad === 0 && (await flat()), JSON.stringify(r));
    const chips = await p.locator('[data-search-group] [data-search-card]').evaluateAll((l) => l.map((e) => e.getBoundingClientRect().height));
    check(`«${q}»: its categories and brands are small chips above the products`, chips.every((h) => h >= 43.5 && h <= 56));
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.waitForTimeout(800);
  }

  // all products, in two columns
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await articles();
  const shop = await cardsOk();
  const a = await p.locator('main article').nth(0).boundingBox();
  const b = await p.locator('main article').nth(1).boundingBox();
  check('«همه‌ی محصولات» is the shared product card, two columns, nothing without a picture or placeholder', shop.n >= 4 && shop.bad === 0 && !!a && !!b && Math.abs(a.y - b.y) < 4 && a.width < 200 && (await flat()), JSON.stringify(shop));

  // three categories
  await p.goto(`${BASE}/shop/categories`, { waitUntil: 'load' });
  const hrefs = await p.locator('[data-category-card]').evaluateAll((l) => l.slice(0, 3).map((e) => e.getAttribute('href')));
  for (const h of hrefs) {
    await p.goto(`${BASE}${h}`, { waitUntil: 'load' });
    await articles();
    const r = await cardsOk();
    check(`the category ${decodeURIComponent(h ?? '').slice(-28)} lists product cards, all with a picture or the placeholder`, r.n >= 1 && r.bad === 0 && (await flat()), JSON.stringify(r));
  }

  // a picture that cannot be loaded becomes the placeholder (the card stays)
  const broken = await browser.newContext({ ...devices['iPhone 8'] });
  await broken.route('**/_next/image**', (r) => r.abort());
  const bp = await broken.newPage();
  await bp.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await bp.locator('main article').first().waitFor({ timeout: 25000 });
  await bp.waitForTimeout(2500);
  const fb = await bp.evaluate(() => {
    const cards = [...document.querySelectorAll('main article')];
    return { n: cards.length, placeholders: cards.filter((c) => c.querySelector('[data-card-placeholder]')).length, empty: cards.filter((c) => !c.querySelector('[data-card-placeholder]') && !c.querySelector('[data-card-image]')).length };
  });
  check('with every picture failing to load, the cards stay and show the Avina placeholder', fb.n >= 4 && fb.placeholders >= 1 && fb.empty === 0, JSON.stringify(fb));
  await broken.close();
} finally {
  await browser.close();
}
finish();
