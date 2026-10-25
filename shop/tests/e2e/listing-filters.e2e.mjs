// Listings package E (read-only):
//  1. price filter (?min / ?max on the final price after discounts) on /shop, a category and a brand page: every card
//     shown is inside the range; Persian digits with separators in the URL work; a range the wrong way round is
//     swapped; the filter UI (two fields + a two-handle slider) is in the form, on phones inside «فیلترها»
//  2. «دسته‌بندی‌ها»: picture cards (a product photo per category), 2 columns on a phone, «مشاهده‌ی همه‌ی
//     محصولات» per parent; «برندها» 2 columns on a phone
//  3. a sub-category page: product cards with pictures, its sister categories as chips (the current one marked)
import { BASE, check, chromium, finish, toLatin } from './_harness.mjs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
/** final prices (toman) of the cards on the page */
const prices = () =>
  page
    .locator('main article')
    .evaluateAll((cards) =>
      cards
        .map((c) => c.querySelector('[class*=price] [class*=amount], [class*=amount]')?.textContent ?? '')
        .filter(Boolean),
    );
/** distinct column starts, allowing for sub-pixel rounding */
const columns = (xs) => new Set(xs.map((x) => Math.round(x / 8))).size;
const toman = (s) => Number(toLatin(s).replace(/[^\d]/g, ''));

try {
  const home = await (await fetch(`${BASE}/`)).text();
  const firstHref = (prefix) => new RegExp(`href="(${prefix}[^"#?]+)"`).exec(home)?.[1];
  const listings = { shop: '/shop', category: firstHref('/c/'), brand: firstHref('/brands/') };

  for (const [name, path] of Object.entries(listings)) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await page.locator('main article').first().waitFor({ timeout: 20000 });
    const all = (await prices()).map(toman).filter((n) => n > 0);
    check(
      `1a ${name}: the price filter is in the form`,
      (await page.locator('aside [data-price-filter] input[name=min]').count()) === 1,
    );
    if (all.length < 2) continue;
    const sorted = [...all].sort((a, b) => a - b);
    const lo = sorted[0];
    const hi = sorted[Math.floor(sorted.length / 2)];
    const sep = path.includes('?') ? '&' : '?';
    // Persian digits with separators, in the URL
    const fa = (n) => encodeURIComponent(new Intl.NumberFormat('fa-IR').format(n));
    await page.goto(`${BASE}${path}${sep}min=${fa(lo)}&max=${fa(hi)}`, { waitUntil: 'load' });
    await page.locator('main article, main [class*=empty]').first().waitFor({ timeout: 20000 });
    const got = (await prices()).map(toman);
    check(
      `1b ${name}: every card within ${lo}–${hi} (final price)`,
      got.length > 0 && got.every((n) => n >= lo && n <= hi),
      `${got.length} cards: ${got.slice(0, 6).join(', ')}`,
    );
    check(
      `1c ${name}: the fields show the range in Persian digits`,
      toman(await page.locator('aside [data-price-filter] input[name=min]').inputValue()) === lo,
    );
    await page.goto(`${BASE}${path}${sep}min=${hi}&max=${lo}`, { waitUntil: 'load' });
    await page.locator('main article, main [class*=empty]').first().waitFor({ timeout: 20000 });
    const swapped = (await prices()).map(toman);
    check(
      `1d ${name}: a range the wrong way round is swapped`,
      swapped.length > 0 && swapped.every((n) => n >= lo && n <= hi),
    );
  }

  // price sort follows the final price
  await page.goto(`${BASE}/shop?sort=price_asc`, { waitUntil: 'load' });
  await page.locator('main article').first().waitFor();
  const asc = (await prices()).map(toman);
  check(
    '1e «ارزان‌ترین»: ordered by what the customer pays',
    asc.every((n, i) => i === 0 || asc[i - 1] <= n),
    asc.slice(0, 8).join(', '),
  );

  // ── 2 and 3 on a phone ──
  const m = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await m.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await m.locator('details[class*=filterMobile] > summary').click();
  check(
    '1f phone: the price filter sits in «فیلترها»',
    await m.locator('details[open] [data-price-filter]').isVisible(),
  );

  await m.goto(`${BASE}/categories`, { waitUntil: 'load' });
  const cards = await m
    .locator('[data-category-card]')
    .evaluateAll((els) =>
      els.map((e) => ({ img: !!e.querySelector('img'), x: Math.round(e.getBoundingClientRect().left) })),
    );
  check(
    '2a categories: picture cards with a product photo',
    cards.length > 5 && cards.filter((c) => c.img).length >= cards.length * 0.8,
    `${cards.filter((c) => c.img).length}/${cards.length}`,
  );
  check('2b categories: 2 columns on a phone', columns(cards.map((c) => c.x)) === 2);
  check(
    '2c each parent has «مشاهده‌ی همه‌ی محصولات»',
    (await m.locator('[data-category-group]').count()) ===
      (await m.getByText('مشاهده‌ی همه‌ی محصولات').count()),
  );
  await m.goto(`${BASE}/brands`, { waitUntil: 'load' });
  const bx = await m
    .locator('main li > a[href^="/brands/"]') // the brand cards (not the breadcrumb)
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  check('2d brands: 2 columns on a phone', columns(bx) === 2, JSON.stringify(bx));

  // a sub-category: the first category card without sub-categories of its own
  await m.goto(`${BASE}/c/172`, { waitUntil: 'load' });
  await m.locator('main article').first().waitFor();
  const imgs = await m.locator('main article img').count();
  check(
    '3a sub-category: product cards with pictures',
    imgs > 0 && imgs === (await m.locator('main article').count()),
  );
  const sib = m.locator('[data-sibling-categories]');
  check(
    '3b sister categories as chips, the current one marked',
    (await sib.locator('a').count()) > 2 && (await sib.locator('a[aria-current=true]').count()) === 1,
  );
  check(
    '3c no horizontal page scroll',
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await m.close();
} finally {
  await browser.close();
}
finish();
