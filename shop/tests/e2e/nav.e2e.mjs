// Header navigation like Liateam's, end to end: the menu bar's items (فروشگاه, برندها, about/contact/FAQ), «فروشگاه»
// opening the category mega menu on hover and going to all products on click, «برندها» listing the brands, the
// all-products page (= every visible product, filter/sort/paging), the brands page, a brand page and its filters,
// brand logos served by our own route, no «/» shortcut on the search box, no horizontal scroll at 390–1920 px.
import { BASE, check, chromium, finish, requireLocalApp, shot, sleep, sql, toLatin } from './_harness.mjs';

requireLocalApp();
const VISIBLE = `p.is_sellable and p.price > 0 and p.missing_since is null`;
const visibleTotal = Number(sql(`select count(*) from product_catalog p where ${VISIBLE}`));
const brands = sql(
  `select b.slug || '|' || b.name || '|' || count(p.id) from brands b
     join product_catalog p on p.brand_code = b.code and ${VISIBLE}
    where b.in_source group by b.code order by b.position nulls last, b.code`,
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((r) => {
    const [slug, name, n] = r.split('|');
    return { slug, name, n: Number(n) };
  });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const go = async (path, ready = 'main h1') => {
  const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector(ready, { timeout: 60000 }).catch(() => {});
  return res;
};
// the desktop bar (the drawer's nav has the same name); hidden panels are left out by :visible
const bar = page.locator('header nav[aria-label="منوی اصلی"]').first();
const count = async () =>
  Number(toLatin((await page.locator('main [role=status]').first().textContent()) ?? ''));

try {
  // ── 1. menu bar ──
  await go('/');
  const items = (await bar.locator('a:visible').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  check(
    '1a bar: فروشگاه, برندها, تخفیفات ویژه, درباره ما, تماس با ما, سوالات متداول (in this order)',
    JSON.stringify(items.slice(0, 6)) ===
      JSON.stringify(['فروشگاه', 'برندها', 'تخفیفات ویژه', 'درباره ما', 'تماس با ما', 'سوالات متداول']),
    items.join(' | '),
  );
  for (const [label, path] of [
    ['درباره ما', '/about'],
    ['تماس با ما', '/contact'],
    ['سوالات متداول', '/help/faq'],
  ]) {
    const href = await bar.getByRole('link', { name: label, exact: true }).getAttribute('href');
    const res = await page.request.get(BASE + href);
    check(`1b «${label}» → ${path} (coming-soon page, 200)`, href === path && res.status() === 200, href);
  }

  // ── 2. «فروشگاه»: hover → category mega menu; click → all products ──
  const shopToggle = page.getByRole('button', { name: 'دسته‌بندی‌های فروشگاه' });
  const shopPanel = page.locator(`[id="${await shopToggle.getAttribute('aria-controls')}"]`);
  await bar.getByRole('link', { name: 'فروشگاه', exact: true }).hover();
  await sleep(250);
  const roots = await shopPanel.locator('ul[aria-label="دسته‌بندی‌های اصلی"] > li > a').count();
  check(
    '2a hover «فروشگاه» opens the category mega menu',
    (await shopPanel.isVisible()) && roots >= 6,
    `${roots} categories`,
  );
  await shot(page, 'nav-shop-menu-1440.png');
  await page.mouse.move(700, 880);
  await sleep(400);
  await shopToggle.focus();
  await page.keyboard.press('Enter');
  check(
    '2b its chevron opens it from the keyboard',
    (await shopToggle.getAttribute('aria-expanded')) === 'true',
  );
  await page.keyboard.press('Escape');
  await Promise.all([
    page.waitForURL(/\/shop$/),
    bar.getByRole('link', { name: 'فروشگاه', exact: true }).click(),
  ]);
  check('2c clicking «فروشگاه» opens all products', new URL(page.url()).pathname === '/shop');

  // ── 3. all products ──
  await go('/shop', 'main [role=status]');
  const all = await count();
  check(
    '3a /shop lists every visible product',
    all === visibleTotal,
    `${all} on the page, ${visibleTotal} in DB`,
  );
  check('3b category chips', (await page.locator('main nav[aria-label="دسته‌بندی محصولات"] a').count()) >= 6);
  await go('/shop?inStock=1&sort=price_asc&page=2', 'main [role=status]');
  const inStock = Number(sql(`select count(*) from product_catalog p where ${VISIBLE} and p.stock > 0`));
  const prices = (await page.locator('main article b').allTextContents())
    .map((t) => Number(toLatin(t)))
    .filter((n) => n > 0);
  check(
    '3c filter + sort + paging work (in stock, cheapest first, page 2)',
    (await count()) === inStock && prices.every((v, i) => i === 0 || prices[i - 1] <= v) && prices.length > 0,
    `${await count()} in stock; ${prices.slice(0, 4).join(',')}`,
  );
  await go('/shop');
  await shot(page, 'shop-1440.png');

  // ── 4. «برندها» menu, brands page, brand page ──
  await go('/');
  await bar.getByRole('link', { name: 'برندها', exact: true }).hover();
  await sleep(250);
  const brandToggle = page.getByRole('button', { name: 'فهرست برندها' });
  const brandPanel = page.locator(`[id="${await brandToggle.getAttribute('aria-controls')}"]`);
  const inMenu = await brandPanel
    .locator('ul[aria-label="برندها"] a')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check(
    '4a hover «برندها» lists the brands in Liateam order',
    JSON.stringify(inMenu) === JSON.stringify(brands.map((b) => `/brands/${b.slug}`)),
    `${inMenu.length}: ${inMenu.join(' ')}`,
  );
  await shot(page, 'nav-brands-menu-1440.png');

  await go('/brands');
  const cards = await page.locator('main ul a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  check(
    '4b /brands shows every brand with products',
    cards.length === brands.length && brands.length === 7,
    `${cards.length} brands`,
  );
  const logo = await page.locator('main ul img[src^="/api/brand-logo/"]').first().getAttribute('src');
  const logoRes = await page.request.get(BASE + logo);
  check(
    '4c logos come from our own route (not the supplier host), scripts blocked',
    logoRes.ok() &&
      /image\//.test(logoRes.headers()['content-type']) &&
      /sandbox/.test(logoRes.headers()['content-security-policy']),
    `${logo} ${logoRes.headers()['content-type']}`,
  );
  check(
    '4d no picture is loaded from s3.liateam.ir directly',
    (await page
      .locator('img[src^="https://s3.liateam.ir"], img[srcset^="https://s3.liateam.ir"]')
      .count()) === 0,
  );
  await shot(page, 'brands-1440.png');

  const big = brands.reduce((a, b) => (b.n > a.n ? b : a));
  await Promise.all([
    page.waitForURL(new RegExp(`/brands/${big.slug}$`)),
    page.locator(`main a[href="/brands/${big.slug}"]`).click(),
  ]);
  await page.waitForSelector('main [role=status]');
  check(
    `4e a brand card opens /brands/${big.slug} with its products`,
    (await count()) === big.n,
    `${await count()} / ${big.n}`,
  );
  const names = await page.locator('main article').evaluateAll((as) => as.length);
  check('4f brand page lists product cards', names > 0, `${names} on page 1`);
  const cat = await page
    .locator('main form[aria-label="فیلترها"] input[name=cat]')
    .first()
    .getAttribute('value');
  await go(`/brands/${big.slug}?cat=${cat}`, 'main [role=status]');
  const inCat = Number(
    sql(`with recursive t(code) as (select ${Number(cat)} union select c.code from categories c join t on c.parent_code = t.code)
         select count(*) from product_catalog p join brands b on b.code = p.brand_code
          where ${VISIBLE} and b.slug = '${big.slug}' and p.category && array(select code from t)`),
  );
  check(
    '4g brand page category filter',
    (await count()) === inCat,
    `cat ${cat}: ${await count()} / ${inCat}`,
  );
  await go(`/brands/${big.slug}`);
  await shot(page, 'brand-1440.png');
  const missing = await page.request.get(BASE + '/brands/no-such-brand');
  check('4h unknown brand is a real 404', missing.status() === 404);

  // ── 5. no «/» shortcut; search itself unchanged ──
  await go('/');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('/');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('type'));
  check('5a «/» no longer jumps to the search box', focused !== 'search', String(focused));
  check(
    '5b no «/» hint in the box',
    (await page.locator('header form[role=search] [aria-hidden=true]', { hasText: '/' }).count()) === 0,
  );
  const box = page.locator('header input[type=search]').first();
  await box.fill('ریمل');
  await page.waitForSelector('header [role=listbox] [role=option]', { timeout: 15000 }).catch(() => {});
  check(
    '5c autocomplete still works',
    (await page.locator('header [role=listbox] [role=option]').count()) > 0,
  );

  // ── 6. mobile drawer + widths ──
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await m.goto(BASE + '/shop', { waitUntil: 'load' });
  await m.getByRole('button', { name: 'منو' }).click();
  const drawer = m.getByRole('dialog');
  const dLinks = (await drawer.locator('a, summary').allInnerTexts()).map((t) => t.split('\n')[0].trim());
  check(
    '6a drawer: همه‌ی محصولات, categories, برندها, درباره ما, تماس با ما, سوالات متداول',
    dLinks[0] === 'همه‌ی محصولات' &&
      ['برندها', 'درباره ما', 'تماس با ما', 'سوالات متداول'].every((x) => dLinks.includes(x)),
    dLinks.join(' | '),
  );
  await drawer.getByText('برندها', { exact: true }).click();
  const dBrands = await drawer.locator('details[open] a').count();
  check('6b drawer «برندها» opens the brand list', dBrands === brands.length + 1, `${dBrands} links`);
  await shot(m, 'drawer-390.png');
  await m.keyboard.press('Escape');
  await m.close();

  for (const width of [390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/shop', '/brands', `/brands/${big.slug}`]) {
      await go(path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(`6 ${width}px ${path}: no horizontal scroll`, over <= 0, `overflow ${over}px`);
      if (width === 390 && path !== `/brands/${big.slug}`)
        await shot(page, `${path.slice(1)}-390.png`, { fullPage: false });
    }
  }
} finally {
  await browser.close();
}
finish();
