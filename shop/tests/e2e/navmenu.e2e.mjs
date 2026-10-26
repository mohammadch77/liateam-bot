// Header menus with products (part 4), desktop: nothing is loaded while a menu is closed; opening «فروشگاه» loads
// the first sub-category's products only; hovering a sub-category shows its products (≤ 6 from 1280 px, ≤ 4 below,
// no sideways scroll at 1024–1920), «مشاهده همه» only when there are more (to that sub-category's page); hovering a
// product swaps the big picture and leaving brings it back; few products → no «مشاهده همه»; an empty one → a message;
// «برندها»: every brand, its products, picture, «مشاهده همه»; keyboard (arrows, Esc); fast hover changes without
// errors; prices like the rest of the site; no purchase price in the API or the HTML; the phone drawer still works.
// Prints the API's response times (first and cached). Read-only.
import { BASE, check, chromium, finish, shot, sql } from './_harness.mjs';

const one = (q) => sql(q).split('\n')[0] ?? '';
const VISIBLE = 'p.is_sellable and p.price > 0 and p.missing_since is null';
const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
const costs = new Map(
  sql(`select id || ':' || coalesce(cost_price, 0) from product_catalog where is_sellable and price > 0`)
    .split('\n')
    .map((l) => l.split(':').map(Number)),
);
const leaks = (text) => {
  const found = [];
  for (const [id, c] of costs)
    if (c && (text.includes(`:${c},`) || text.includes(`:${c}}`) || text.includes(fa(c)))) found.push(id);
  for (const w of ['cost', 'payable', 'discount_price']) if (text.includes(w)) found.push(w);
  return found;
};
const inStockCount = (code) =>
  Number(
    one(`select count(*) from product_catalog p where ${VISIBLE} and p.stock > 0 and p.category && array(
      with recursive t(c) as (select ${code} union select x.code from categories x join t on x.parent_code = t.c) select c from t)`),
  );

const browser = await chromium.launch();
const errors = [];
const open = async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => errors.push(`${width}: ${e.message}`));
  const navCalls = [];
  page.on('request', (r) => r.url().includes('/api/nav/products') && navCalls.push(r.url()));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  return { page, navCalls };
};
const panel = (page) => page.locator('header [class*=panel]:not([hidden])').first();

try {
  // ── 1. closed menus load nothing; HTML has no product data ──
  const { page, navCalls } = await open(1440);
  await page.waitForTimeout(800);
  check(
    '1a closed menus: no /api/nav/products request on page load',
    navCalls.length === 0,
    `${navCalls.length}`,
  );
  check(
    '1b no menu product card in the page HTML',
    (await page.content()).includes('data-nav-product=') === false,
  );

  // ── 2. «فروشگاه» ──
  await page
    .locator('header nav[aria-label="منوی اصلی"] > div > div')
    .first()
    .locator('span')
    .first()
    .hover();
  const p = panel(page);
  await p.locator('[data-nav-product]').first().waitFor({ timeout: 20000 });
  check(
    '2a open: only the first sub-category of the open category is loaded',
    navCalls.length === 1,
    navCalls.map((u) => u.split('?')[1]).join(' '),
  );
  // hover a sub-category with many products
  const many = p.locator('a[class*=child]', { hasText: 'بادی میست' });
  const manyHref = await many.getAttribute('href');
  await many.hover();
  await page.waitForFunction(() =>
    document.querySelector('[id=nav-products-of]')?.textContent?.includes('بادی میست'),
  );
  await p.locator('[data-nav-products][aria-busy=false]').waitFor({ timeout: 20000 });
  const cards = await p.locator('[data-nav-product]').count();
  check('2b hover «بادی میست» (20 in stock): 6 cards at 1440', cards === 6, `${cards}`);
  const all = p.locator('[data-nav-all]');
  check(
    '2c more than shown → «مشاهده همه» to the sub-category page',
    (await all.count()) === 1 && (await all.getAttribute('href')) === manyHref,
    `${await all.getAttribute('href')} vs ${manyHref}`,
  );
  // product hover swaps the picture
  await p.locator('[data-nav-product]').nth(2).hover();
  await page.waitForTimeout(300);
  const swapped = await p.locator('[data-preview-image]').count();
  await p.locator('a[class*=child]').first().hover();
  await page.waitForTimeout(300);
  check(
    '2d hovering a product shows its picture; leaving brings the category picture back',
    swapped === 1 && (await p.locator('[data-preview-image]').count()) === 0,
  );
  // few products: no «مشاهده همه»
  await p.locator('a[class*=child]', { hasText: /^عطر/ }).first().hover();
  await page.waitForFunction(() =>
    /پرفروش‌های عطر$/.test(document.querySelector('[id=nav-products-of]')?.textContent?.trim() ?? ''),
  );
  await p.locator('[data-nav-products][aria-busy=false]').waitFor({ timeout: 20000 });
  const few = await p.locator('[data-nav-product]').count();
  check(
    '2e «عطر» (≤ 6 in stock): all shown, no «مشاهده همه»',
    few === inStockCount(151) && few <= 6 && (await p.locator('[data-nav-all]').count()) === 0,
    `${few}`,
  );
  // prices like the rest of the site
  const first = await p.locator('[data-nav-product]').first();
  const fid = Number(await first.getAttribute('data-nav-product'));
  const shown = Number(
    (await first.locator('[class*=current] b').innerText())
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/\D/g, ''),
  );
  const product = await (
    await page.request.get(
      `${BASE}/api/search/suggest?q=${encodeURIComponent(one(`select name from product_catalog where id = ${fid}`).split(' ').slice(0, 2).join(' '))}`,
    )
  ).json();
  const same = product.products.find((x) => x.href.endsWith(`-${fid}`));
  check(
    '2f card price = the price shown elsewhere on the site',
    !same || same.priceToman === shown,
    `${shown} vs ${same?.priceToman}`,
  );
  // fast hover changes
  for (const label of ['بادی میست', 'مام رول', 'عطر', 'بادی میست', 'مام رول'])
    await p
      .locator('a[class*=child]', { hasText: label })
      .first()
      .hover({ timeout: 2000 })
      .catch(() => {});
  await page.waitForTimeout(1500);
  check(
    '2g fast hover changes: no page error, the last hovered wins',
    errors.length === 0 && /مام رول/.test(await page.locator('[id=nav-products-of]').innerText()),
    errors.join(' '),
  );
  await shot(page, 'nav-shop-1440.png');

  // ── 3. empty sub-category (the API answers with no products) ──
  await page.route('**/api/nav/products?cat=153*', (r) =>
    r.fulfill({ json: { items: [], more: false, allHref: '/c/153' } }),
  );
  await page.reload({ waitUntil: 'load' });
  await page
    .locator('header nav[aria-label="منوی اصلی"] > div > div')
    .first()
    .locator('span')
    .first()
    .hover();
  await panel(page).locator('a[class*=child]', { hasText: 'مام رول' }).hover();
  await page.waitForTimeout(600);
  check(
    '3 a sub-category without products in stock: a message, no cards',
    /فعلاً محصول موجودی/.test(await panel(page).locator('[data-nav-products]').innerText()),
  );
  await page.unroute('**/api/nav/products?cat=153*');

  // ── 4. keyboard ──
  await page.reload({ waitUntil: 'load' });
  const toggle = page.getByRole('button', { name: 'دسته‌بندی‌های فروشگاه' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await panel(page).waitFor();
  await page.keyboard.press('Tab');
  const firstRoot = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('ArrowDown');
  const secondRoot = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('Escape');
  check(
    '4 keyboard: Enter opens, arrows move between categories, Esc closes and returns to the button',
    firstRoot !== secondRoot &&
      !!secondRoot &&
      (await page
        .locator('ul[aria-label="دسته‌بندی‌های اصلی"] > li > a', { hasText: secondRoot })
        .count()) === 1 &&
      (await toggle.getAttribute('aria-expanded')) === 'false' &&
      (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) ===
        'دسته‌بندی‌های فروشگاه',
    `${firstRoot} → ${secondRoot}`,
  );

  // ── 5. «برندها» ──
  await page.locator('header nav[aria-label="منوی اصلی"] > div > div').nth(1).locator('span').first().hover();
  const bp = page.locator('[data-brand-panel]');
  await bp.waitFor({ state: 'visible' });
  const brands = await bp.locator('[data-nav-brand]').count();
  const dbBrands = Number(
    one(
      `select count(distinct b.code) from brands b join product_catalog p on p.brand_code = b.code and ${VISIBLE} where b.in_source`,
    ),
  );
  check('5a every brand with products is in the menu', brands === dbBrands, `${brands} / ${dbBrands}`);
  const big = bp.locator('[data-nav-brand]', { hasText: 'تراست پرو' });
  const bigHref = await big.getAttribute('href');
  await big.hover();
  await page.waitForFunction(() =>
    /تراست پرو/.test(document.querySelector('[data-brand-panel] [class*=paneAll]')?.textContent ?? ''),
  );
  await bp
    .locator('[data-nav-products][aria-busy=false] [data-nav-product]')
    .first()
    .waitFor({ timeout: 20000 });
  check(
    '5b brand «تراست پرو»: 6 products, «مشاهده همه» to its page',
    (await bp.locator('[data-nav-product]').count()) === 6 &&
      (await bp.locator('[data-nav-all]').getAttribute('href')) === bigHref,
  );
  await bp.locator('[data-nav-product]').first().hover();
  await page.waitForTimeout(300);
  check(
    '5c hovering a brand product shows its picture',
    (await bp.locator('[data-preview-image]').count()) === 1,
  );
  await shot(page, 'nav-brands-1440.png');

  // ── 6. widths: ≤ cap, no sideways scroll ──
  for (const w of [1024, 1280, 1440, 1920]) {
    const { page: q } = await open(w);
    await q.locator('header nav[aria-label="منوی اصلی"] > div > div').first().locator('span').first().hover();
    const qp = panel(q);
    await qp.locator('a[class*=child]', { hasText: 'بادی میست' }).hover();
    await q.waitForFunction(() =>
      document.querySelector('[id=nav-products-of]')?.textContent?.includes('بادی میست'),
    );
    await qp.locator('[data-nav-products][aria-busy=false]').waitFor({ timeout: 20000 });
    const n = await qp.locator('[data-nav-product]').count();
    const over = await q.evaluate(() => {
      const grid = document.querySelector('header [class*=panel]:not([hidden]) [class*=productGrid]');
      return [
        document.documentElement.scrollWidth - innerWidth,
        grid ? grid.scrollWidth - grid.clientWidth : 0,
      ];
    });
    check(
      `6 ${w}px: ${w >= 1280 ? 6 : 4} cards at most, no sideways scroll`,
      n === (w >= 1280 ? 6 : 4) && over[0] <= 0 && over[1] <= 0,
      `${n} cards, overflow ${over}`,
    );
    if (w === 1280 || w === 1920) {
      await shot(q, `nav-shop-${w}.png`);
      await qp.locator('[data-nav-product]').nth(1).hover();
      await q.waitForTimeout(1500);
      await shot(q, `nav-shop-hover-${w}.png`);
      await q.keyboard.press('Escape');
      await q
        .locator('header nav[aria-label="منوی اصلی"] > div > div')
        .nth(1)
        .locator('span')
        .first()
        .hover();
      await q.locator('[data-brand-panel] [data-nav-product]').first().waitFor({ timeout: 20000 });
      await q.waitForTimeout(1500);
      await shot(q, `nav-brands-${w}.png`);
    }
    await q.close();
  }

  // ── 7. API: input checks, public fields, no purchase price, timing ──
  const bad = await Promise.all(
    ['?cat=abc', '?cat=1&brand=1', '?limit=6', '?cat=155&limit=99'].map(async (qs) =>
      (await page.request.get(`${BASE}/api/nav/products${qs}`)).status(),
    ),
  );
  check(
    '7a invalid input → 422 (bad id, both / neither target, limit over the cap)',
    bad.every((s) => s === 422),
    bad.join(','),
  );
  check(
    '7b unknown category → 404',
    (await page.request.get(`${BASE}/api/nav/products?cat=999999`)).status() === 404,
  );
  const code = Number(
    one(
      `select code from brands b where in_source and exists (select 1 from product_catalog p where p.brand_code = b.code and ${VISIBLE}) order by code desc limit 1`,
    ),
  );
  const t0 = Date.now();
  const r1 = await page.request.get(`${BASE}/api/nav/products?brand=${code}&limit=5`);
  const cold = Date.now() - t0;
  const t1 = Date.now();
  await page.request.get(`${BASE}/api/nav/products?brand=${code}&limit=5`);
  const warm = Date.now() - t1;
  const body = await r1.text();
  const keys = Object.keys(JSON.parse(body).items[0] ?? {})
    .sort()
    .join(',');
  check(
    '7c response: public fields only, no purchase price',
    keys === 'href,id,imageUrl,inStock,name,oldPriceToman,priceToman' && !leaks(body).length,
    keys,
  );
  console.log(`   API time: first ${cold} ms, cached ${warm} ms`);
  check('7d cached response is quick (< 100 ms)', warm < 100, `${cold} → ${warm} ms`);
  check('7e home HTML: no purchase price', !leaks(await page.content()).length);

  // ── 8. phone drawer unchanged ──
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  await m.getByRole('button', { name: 'منو' }).click();
  const drawer = m.getByRole('dialog');
  const dLinks = (await drawer.locator('a, button').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  check(
    '8 phone drawer: categories, brands, the plain links; no product cards',
    dLinks.some((d) => d.startsWith('همه‌ی برندها')) &&
      dLinks.includes('همکاری در فروش') &&
      (await drawer.locator('[data-nav-product]').count()) === 0,
    dLinks.slice(0, 6).join(' | '),
  );
} finally {
  await browser.close();
}
finish();
