// Catalog end to end against the running app and the local Docker database: home, category (count, paging,
// sort, sub-category and stock filters), product page, search, a DB price/stock change showing up, hidden
// products, canonical redirects, SEO tags, images through /_next/image. Changes one product row and restores it.
import { BASE, check, chromium, fa, finish, requireLocalApp, sql, toLatin } from './_harness.mjs';

requireLocalApp();
const VISIBLE = `is_sellable and price > 0 and missing_since is null`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const go = async (path) => {
  const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120000 });
  // listing pages stream behind a skeleton: wait for the real content (result count or an empty state)
  if (res?.ok() && /^\/(search|c\/)/.test(path)) {
    await page.waitForSelector('main [role=status], main [class*=empty]', { timeout: 60000 }).catch(() => {});
  }
  if (res?.ok() && /^\/[^/]+$/.test(path) && path !== '/shop' && path !== '/offers') {
    await page.waitForSelector('[class*=buyBox]', { timeout: 60000 }).catch(() => {});
  }
  return res;
};
const cards = () => page.locator('main article');
const cardPrices = async () =>
  (await page.locator('main article b').allTextContents())
    .map((t) => Number(toLatin(t)))
    .filter((n) => n > 0);

// ── 1. home: real categories and products ──
await go('/');
const bubbles = await page.locator('nav[aria-label="دسته‌بندی‌های اصلی"] a').count();
const navCats = await page.locator('header ul[aria-label="دسته‌بندی‌های اصلی"] > li > a').count();
const homeCards = await cards().count();
const dbRoots = Number(sql(`select count(*) from categories where parent_code is null and name is not null`));
check(
  '1a home: category bubbles from the categories table',
  bubbles >= 6,
  `${bubbles} bubbles, ${navCats} in header (${dbRoots} roots in DB)`,
);
const firstName = (await cards().first().locator('h3').textContent()).trim();
const inDb = sql(
  `select count(*) from product_catalog where name ilike '%${firstName.slice(0, 12).replace(/'/g, "''")}%' and ${VISIBLE}`,
);
check(
  '1b home: product cards are real synced products',
  homeCards >= 10 && Number(inDb) >= 1,
  `${homeCards} cards, first «${firstName.slice(0, 30)}»`,
);

// ── 2. category: filters, sort, pagination ──
await go('/c/173');
const catUrl = page.url(); // final URL after the canonical redirect
const catName = await page.locator('main h1').textContent();
const catTotal = Number(toLatin((await page.locator('main [role=status]').textContent()) ?? ''));
const dbCat = Number(
  sql(
    `select count(*) from product_catalog where ${VISIBLE} and category && array(select code from categories where code=173 or parent_code=173)`,
  ),
);
check(
  '2a category name from categories table, count = DB (incl. sub-categories)',
  catName.includes('آرایشی') && catTotal === dbCat,
  `«${catName}» ${catTotal} vs DB ${dbCat}`,
);
check('2b page 1 shows 20 cards (page size)', (await cards().count()) === Math.min(20, dbCat));
await page.locator('nav[aria-label="صفحه‌بندی"] a[aria-label="صفحه ۲"]').click();
await page.waitForURL(/page=2/);
check(
  '2c pagination: page 2 shows the rest',
  (await cards().count()) === dbCat - 20,
  `${await cards().count()} on page 2`,
);

await go(new URL(catUrl).pathname + '?sort=price_asc');
let prices = await cardPrices();
check(
  '2d sort: price ascending',
  prices.length > 3 && prices.every((p, i) => i === 0 || prices[i - 1] <= p),
  prices.slice(0, 6).join(' ≤ '),
);
await go(new URL(catUrl).pathname + '?sort=price_desc');
prices = await cardPrices();
check(
  '2e sort: price descending',
  prices.every((p, i) => i === 0 || prices[i - 1] >= p),
  prices.slice(0, 6).join(' ≥ '),
);

await go(new URL(catUrl).pathname);
await page.locator('aside').getByRole('radio', { name: /ریمل/ }).check(); // auto-submits
await page.waitForURL(/cat=174/);
const sub = Number(toLatin((await page.locator('main [role=status]').textContent()) ?? ''));
const dbSub = Number(sql(`select count(*) from product_catalog where ${VISIBLE} and 174 = any(category)`));
check('2f filter by sub-category (auto-submit)', sub === dbSub, `ریمل: ${sub} vs DB ${dbSub}`);
await go(new URL(catUrl).pathname + '?inStock=1');
const outOnStockFilter = await page.locator('main article', { hasText: 'ناموجود' }).count();
check('2g «فقط موجود» filter hides out-of-stock', outOnStockFilter === 0);

// ── 3. PDP price and stock ──
const pid = Number(sql(`select id from product_catalog where ${VISIBLE} and stock >= 5 order by id limit 1`));
const dbPrice = Number(sql(`select price from product_catalog where id=${pid}`));
await go(`/${pid}`);
const buyBox = () => page.locator('[class*=buyBox]');
const shown = (await buyBox().locator('[class*=amount]').first().textContent()).trim();
check(
  '3a PDP price = stored toman, unchanged (Persian digits)',
  shown === fa(dbPrice),
  `DB ${dbPrice} toman → «${shown}»`,
);
check('3b PDP stock state', (await page.locator('main').getByText('موجود', { exact: true }).count()) >= 1);
const crumbs = await page.locator('nav[aria-label="مسیر"] li').allTextContents();
check(
  '3c breadcrumb includes the category trail',
  crumbs.filter((t) => t.trim()).length >= 3,
  crumbs.filter((t) => t.trim()).join(' › '),
);

// ── 4. search ──
await go('/search?q=' + encodeURIComponent('ريمل')); // Arabic yeh, as some keyboards type it
const searchNames = await page.locator('main article h3').allTextContents();
check(
  '4a search by name (Arabic ي matches Persian ی)',
  searchNames.length > 0 && searchNames.every((n) => n.includes('ریمل')),
  `${searchNames.length} results`,
);
await go('/search?q=' + encodeURIComponent('qqzzxx'));
check('4b no results → empty state', (await page.getByText('نتیجه‌ای برای').count()) === 1);
await go('/search?q=' + encodeURIComponent('شامپو') + '&sort=price_asc&inStock=1');
prices = await cardPrices();
check(
  '4c search keeps filters and sort',
  prices.length > 0 && prices.every((p, i) => i === 0 || prices[i - 1] <= p),
);

// ── 5. change price/stock in the DB → page updates ──
const orig = sql(`select price || ',' || stock from supplier_products where id=${pid}`)
  .split(',')
  .map(Number);
sql(`update supplier_products set price = ${orig[0] + 120000}, stock = 0 where id=${pid}`);
await go(`/${pid}`);
const updated =
  (await buyBox().locator('[class*=amount]').count()) === 0 &&
  (await page.getByText('این کالا در حال حاضر موجود نیست').count()) === 1;
sql(`update supplier_products set stock = ${orig[1]} where id=${pid}`);
await go(`/${pid}`);
const newShown = (await buyBox().locator('[class*=amount]').first().textContent()).trim();
check(
  '5 DB price/stock change appears on the next page view',
  updated && newShown === fa(orig[0] + 120000),
  `price → «${newShown}», out of stock shown`,
);
sql(`update supplier_products set price = ${orig[0]}, stock = ${orig[1]} where id=${pid}`);

// ── 6. out of stock labelled; invalid price hidden; not sellable hidden ──
const oos = Number(
  sql(`select id from product_catalog where ${VISIBLE} and stock = 0 order by id limit 1`) || 0,
);
if (oos) {
  await go(`/${oos}`);
  check(
    '6a out-of-stock product: visible, labelled, cannot be bought',
    (await page.locator('main').getByText('ناموجود').count()) >= 1 &&
      (await buyBox().getByRole('button', { name: 'افزودن به سبد', exact: true }).count()) === 0,
  );
} else check('6a out-of-stock product exists to test', false);
sql(`update supplier_products set price = 0 where id=${pid}`);
const zero = await go(`/${pid}`);
await go(
  '/search?q=' +
    encodeURIComponent(await sql(`select split_part(name,' ',1) from supplier_products where id=${pid}`)),
);
const listed = await page.locator(`main a[href^="/${pid}-"], main a[href$="-${pid}"]`).count();
sql(`update supplier_products set price = ${orig[0]} where id=${pid}`);
check(
  '6b price 0 → product hidden (PDP 404, not in lists)',
  zero.status() === 404 && listed === 0,
  `PDP ${zero.status()}, in search: ${listed}`,
);
const notSellable = Number(
  sql(`select id from supplier_products where not is_sellable and price > 0 limit 1`) || 0,
);
const ns = await go(`/${notSellable}`);
check('6c not-sellable (excluded category) product → 404', ns.status() === 404);

// ── an old/short link with filters keeps them through the canonical redirect ──
const kept = await fetch(BASE + '/c/173?sort=price_asc&inStock=1', { redirect: 'manual' });
check(
  'canonical redirect keeps the query (sort, filters)',
  kept.status === 308 && (kept.headers.get('location') ?? '').endsWith('?sort=price_asc&inStock=1'),
  decodeURIComponent(kept.headers.get('location') ?? ''),
);

// ── SEO basics ──
await go(new URL(catUrl).pathname);
const title = await page.title();
const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
check(
  'SEO: title + canonical on category',
  title.includes('آرایشی') && !!canonical,
  `${title} | ${decodeURIComponent(canonical ?? '')}`,
);
const r308 = await fetch(`${BASE}/${pid}`, { redirect: 'manual' });
check(
  'SEO: /<id> without slug → 301 to the English slug at the root',
  r308.status === 301 &&
    /^\/[a-z0-9-]+-\d+$/.test(new URL(r308.headers.get('location') ?? '/', BASE).pathname),
  decodeURIComponent(r308.headers.get('location') ?? ''),
);

// ── images come through our optimiser, never from the supplier ──
await go('/');
const srcs = await page.locator('main img').evaluateAll((imgs) => imgs.map((i) => i.currentSrc || i.src));
// brand logos: only our own route on this site (same origin, path /api/brand-logo/<code>), no other host
const ownLogo = (src) => {
  const u = new URL(src, BASE);
  return u.origin === new URL(BASE).origin && /^\/api\/brand-logo\/\d+$/.test(u.pathname);
};
check(
  'images served by /_next/image or our own /api/brand-logo/ route (no hotlink to s3.liateam.ir)',
  srcs.length > 0 &&
    srcs.every(
      (s) =>
        ((new URL(s, BASE).origin === new URL(BASE).origin && new URL(s, BASE).pathname === '/_next/image') ||
          ownLogo(s)) &&
        !s.startsWith('https://s3.'),
    ),
  `${srcs.length} images`,
);

// every link of the header, footer and mobile tab bar answers 200 (pages not built yet show «به‌زودی»)
const links = new Set();
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  await page.setViewportSize(viewport);
  await go('/');
  const hrefs = await page
    .locator('header a[href^="/"], footer a[href^="/"], nav[aria-label="ناوبری اصلی"] a[href^="/"]')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  hrefs.forEach((h) => links.add(h));
}
const broken = [];
for (const href of links) {
  const res = await fetch(BASE + href, { redirect: 'follow' });
  if (res.status !== 200) broken.push(`${href} → ${res.status}`);
}
check(
  'no header/footer/tab-bar link is broken',
  !broken.length,
  broken.length ? broken.join(', ') : `${links.size} links, all 200`,
);
const news = await fetch(`${BASE}/api/newsletter`, {
  method: 'POST',
  body: new URLSearchParams({ phone: '09120000000' }),
  redirect: 'manual',
});
check(
  'newsletter form → 303 to the «به‌زودی» page',
  news.status === 303 && news.headers.get('location') === '/newsletter',
);
const soon = await fetch(`${BASE}/legal/terms`);
const soonHtml = await soon.text();
check(
  '«به‌زودی» page: HTTP 200, message, not indexed',
  soon.status === 200 && soonHtml.includes('به‌زودی در دسترس قرار می‌گیرد') && /noindex/.test(soonHtml),
);
check('unknown help/legal topic is a real 404', (await fetch(`${BASE}/help/nope`)).status === 404);

await browser.close();
finish();
