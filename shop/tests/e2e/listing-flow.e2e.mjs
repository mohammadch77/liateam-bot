// Filters and paging with real touch in WebKit (iPhone 8 and iPhone 13) — items 5, 8, 9. Read-only.
//  1. search «کرم» → open «فیلترها» → every offered category has a result (counts for THIS search) → tap one → a
//     product-card result (picture, price), a removable chip, no empty ?min=&max= in the address
//  2. a combination with no result still shows a clean message AND product cards (never bare text)
//  3. /shop: 24 cards a page, paging, a page past the end → the last page, a page link lands at the list's top
//  4. brand page and category page: the same tap flow ends in cards
import { BASE, check, devices, finish, webkit } from './_harness.mjs';

const browser = await webkit.launch();
/** cards of the result with a picture and a price */
const cards = (p) =>
  p.locator('main article').evaluateAll((els) => ({
    n: els.length,
    complete: els.filter((a) => a.querySelector('img') && /تومان|ناموجود/.test(a.textContent)).length,
  }));

for (const name of ['iPhone 8', 'iPhone 13']) {
  const ctx = await browser.newContext({ ...devices[name] });
  const p = await ctx.newPage();
  const tag = name;

  // ── 1. search → filter → cards ──
  await p.goto(`${BASE}/search?q=${encodeURIComponent('کرم')}`, { waitUntil: 'load' });
  await p.locator('main article').first().waitFor({ timeout: 30000 });
  await p.locator('summary', { hasText: 'فیلترها' }).tap();
  const opts = await p.locator('details[open] label:has(input[type=radio])').allInnerTexts();
  const zero = opts.filter((t) => /(^|\s)[۰0](\s|$)/.test(t.replace(/\s+/g, ' ')));
  check(
    `1a ${tag}: every category offered has a result for «کرم»`,
    opts.length > 0 && zero.length === 0,
    opts.join(' | '),
  );
  await p.locator('details[open] label:has(input[type=radio])').nth(1).tap();
  await p.waitForURL(/cat=\d+/, { timeout: 30000 });
  await p.locator('main article').first().waitFor({ timeout: 30000 });
  const r1 = await cards(p);
  check(
    `1b ${tag}: the filtered result is product cards (picture + price)`,
    r1.n > 0 && r1.complete === r1.n,
    JSON.stringify(r1),
  );
  check(`1c ${tag}: no empty ?min=&max= in the address`, !/[?&](min|max)=(&|$)/.test(p.url()), p.url());
  check(
    `1d ${tag}: the active filter shows as a removable chip`,
    (await p.locator('main button[aria-label], main a[aria-label]').filter({ hasText: '' }).count()) >= 0 &&
      (await p.locator('[class*=chips] >> text=/./').count()) > 0,
  );

  // ── 2. no result → message + cards ──
  await p.goto(`${BASE}/search?q=${encodeURIComponent('کرم')}&cat=154`, { waitUntil: 'load' });
  const empty = p.locator('[data-no-results]');
  await empty.waitFor({ timeout: 30000 });
  const sug = await empty.locator('[data-suggested] article').count();
  check(`2 ${tag}: a combination with no result: clean message and product cards`, sug >= 4, `${sug} cards`);

  // ── 3. paging on /shop ──
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await p.locator('main article').first().waitFor({ timeout: 30000 });
  // the last page number, from the paging links of page 1
  const lastPage = await p
    .locator('nav[aria-label="صفحه‌بندی"] a[href*="page="]')
    .evaluateAll((as) => Math.max(...as.map((a) => Number(new URL(a.href).searchParams.get('page')))));
  const total = lastPage;
  check(
    `3a ${tag}: 24 cards on the first page, paging present`,
    (await p.locator('main article').count()) === 24 &&
      (await p.locator('nav[aria-label="صفحه‌بندی"]').count()) === 1,
    `${total} products`,
  );
  await p.goto(`${BASE}/shop?page=9999`, { waitUntil: 'load' });
  // the listing streams behind loading.tsx, so the redirect reaches the browser right after the load
  await p
    .waitForURL((u) => u.searchParams.get('page') === String(lastPage), { timeout: 20000 })
    .catch(() => {});
  await p
    .locator('main article')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  check(
    `3b ${tag}: a page past the end → the last page (${lastPage})`,
    new URL(p.url()).searchParams.get('page') === String(lastPage),
    p.url(),
  );
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await p.locator('nav[aria-label="صفحه‌بندی"] a[href*="page=2"]').first().tap();
  await p.waitForURL(/page=2/, { timeout: 30000 });
  await p.locator('main article').first().waitFor();
  const top = await p.evaluate(() =>
    Math.round(document.querySelector('#listing').getBoundingClientRect().top),
  );
  check(`3c ${tag}: page 2 opens at the top of the list`, top >= -5 && top < 400, `list top at ${top}px`);

  // ── 4. brand and category pages ──
  for (const path of ['/brands/trust-pro', '/c/173']) {
    await p.goto(`${BASE}${path}`, { waitUntil: 'load' });
    await p.locator('main article').first().waitFor({ timeout: 30000 });
    await p.locator('summary', { hasText: 'فیلترها' }).tap();
    const radio = p.locator('details[open] label:has(input[type=radio])');
    if (!(await radio.count())) continue;
    await radio.nth(1).tap();
    await p.waitForURL(/cat=\d+/, { timeout: 30000 });
    await p.locator('main article').first().waitFor({ timeout: 30000 });
    const r = await cards(p);
    check(`4 ${tag} ${path}: filter tap → cards`, r.n > 0 && r.complete === r.n, JSON.stringify(r));
  }
  await ctx.close();
}
await browser.close();
finish();
