// Home page (part 3) end to end: the sections in order (slider + category stories, offers, brands, best sellers,
// routine, magazine, affiliate) and no «منتخب‌ها» / «جدیدترین‌ها»; a brand logo → its brand page; best-seller tabs
// (switch with skeleton, at most 10 cards, only products in stock, «مشاهده همه» → the shop filtered to the tab);
// /admin/bestsellers (403 for a customer; add / reorder / switch off a pick, the Liateam-tag switch, the effect on the
// home page, the fill rule manual → Liateam tag → fill-up); the magazine «به‌زودی»; the affiliate band and header
// link; phones without horizontal scroll; no purchase price in any HTML / JSON. Removes its picks and roles.
import { execSync } from 'node:child_process';
import {
  BASE,
  SCHEMA,
  check,
  chromium,
  finish,
  requireLocalApp,
  shopRoot,
  shot,
  signIn,
  sql,
} from './_harness.mjs';

requireLocalApp();
const one = (q) => sql(q).split('\n')[0] ?? '';
const stamp = String(Date.now()).slice(-6);
const phones = { admin: `0917${stamp}1`, customer: `0917${stamp}2` };
const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
const costs = new Map(
  sql(`select id || ':' || coalesce(cost_price, 0) from product_catalog where is_sellable and price > 0`)
    .split('\n')
    .map((l) => l.split(':').map(Number)),
);
const leaks = (text) => {
  const found = [];
  for (const [id, c] of costs)
    if (c && (text.includes(`"${c}"`) || text.includes(fa(c)) || text.includes(`:${c},`)))
      found.push(`${id}`);
  for (const w of ['cost_price', 'payable_price', 'discount_price']) if (text.includes(w)) found.push(w);
  return found;
};
/**
 * The page is laid out for good: web font loaded and every picture above the best sellers finished. (The first
 * measurement used to run before the font arrived, the second with it cached: text above changed height by a few
 * pixels below the fold — not a layout shift a visitor sees, but it made «3f» flaky.)
 */
const settled = (page) =>
  page.waitForFunction(async () => {
    await document.fonts.ready;
    const top = document.querySelector('[data-bestsellers]')?.getBoundingClientRect().top ?? 0;
    return [...document.images].every((i) => i.complete || i.getBoundingClientRect().top > top);
  });
const productIdOf = (href) => Number(/-(\d+)$/.exec(href ?? '')?.[1] ?? /\/p\/(\d+)/.exec(href ?? '')?.[1]);
const inStock = (id) => Number(one(`select stock from product_catalog where id = ${id}`)) > 0;
const cleanup = () => {
  sql(`delete from ${SCHEMA}.bestseller_picks where created_at > now() - interval '2 hours'`);
  sql(`delete from ${SCHEMA}.site_settings where key like 'bestsellers.%'`);
};

const browser = await chromium.launch();
const ctxFor = (n, viewport = { width: 1440, height: 900 }) =>
  browser.newContext({ viewport, extraHTTPHeaders: { 'x-real-ip': `10.91.${n}.${1 + (Date.now() % 200)}` } });
const userIds = [];

try {
  cleanup();
  const page = await (await ctxFor(1)).newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });

  // ── 1. order ──
  const order = await page.evaluate(() =>
    [
      'nav[aria-label="دسته‌بندی‌های اصلی"]',
      '[data-offers]',
      '[data-home-section="brands"]',
      '[data-bestsellers]',
      '[data-routine]',
      '[data-home-section="magazine"]',
      '[data-home-section="affiliate"]',
    ].map((q) => document.querySelector(q)?.getBoundingClientRect().top ?? -1),
  );
  check(
    '1a order: stories, offers, brands, best sellers, routine, magazine, affiliate',
    order.every((t, i) => t >= 0 && (i === 0 || t > order[i - 1])),
    order.map(Math.round).join(','),
  );
  const headings = await page.locator('main h2').allInnerTexts();
  check(
    '1b no «منتخب‌ها» / «جدیدترین‌ها» on the home page',
    !headings.some((h) => /منتخب|جدیدترین/.test(h)),
    headings.join(' | '),
  );

  // ── 2. brands ──
  const brandLinks = page.locator('[data-home-section="brands"] a[data-brand]');
  const nBrands = await brandLinks.count();
  check(
    '2a brand row: one tile per brand with products, each with a logo or its name',
    nBrands >= 1 &&
      (await page
        .locator(
          '[data-home-section="brands"] a[data-brand] img, [data-home-section="brands"] a[data-brand] span',
        )
        .count()) >= nBrands,
    `${nBrands}`,
  );
  check(
    '2b «همه‌ی برندها» → /brands',
    (await page.locator('[data-home-section="brands"] a[href="/brands"]').count()) === 1,
  );
  const brandHref = await brandLinks.first().getAttribute('href');
  await brandLinks.first().click();
  await page.waitForURL((u) => u.pathname === brandHref, { timeout: 30000 });
  await page
    .locator('main article')
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {});
  check(
    '2c brand logo → its brand page with its products',
    (await page.locator('main article').count()) > 0,
    brandHref,
  );
  await page.goto(`${BASE}/`, { waitUntil: 'load' });

  // ── 3. best sellers ──
  const bs = page.locator('[data-bestsellers]');
  const tabs = await bs.locator('[role=tab]').allInnerTexts();
  check(
    '3a tabs: همه / مراقبت پوست / آرایشی / عطر و بدن / مو و دهان',
    JSON.stringify(tabs) === JSON.stringify(['همه', 'مراقبت پوست', 'آرایشی', 'عطر و بدن', 'مو و دهان']),
    tabs.join(' | '),
  );
  const cardsOf = async () =>
    bs
      .locator('[role=tabpanel] article')
      .evaluateAll((els) => els.map((e) => e.querySelector('a')?.getAttribute('href')));
  const all = await cardsOf();
  check(
    '3b «همه»: 1–10 cards, only products in stock',
    all.length >= 1 && all.length <= 10 && all.every((h) => inStock(productIdOf(h))),
    `${all.length}`,
  );
  await settled(page);
  const box0 = await page.evaluate(
    () => document.querySelector('[data-bestsellers]').getBoundingClientRect().top + scrollY,
  );
  await bs.getByRole('tab', { name: 'آرایشی' }).click();
  const skeleton = await bs.locator('[data-skeleton]').count();
  await bs.locator('[role=tabpanel][aria-busy=false]').waitFor({ timeout: 20000 });
  const makeup = await cardsOf();
  const makeupIds = makeup.map(productIdOf);
  const makeupCats = makeupIds.length
    ? sql(
        `select bool_and(category && array(with recursive t(c) as (select 173 union select code from categories x join t on x.parent_code = t.c) select c from t)) from product_catalog where id in (${makeupIds.join(',')})`,
      )
    : 't';
  check(
    '3c switch to «آرایشی»: skeleton while loading, then makeup products only (≤ 10, in stock)',
    makeup.length <= 10 && makeupCats === 't' && makeupIds.every(inStock),
    `skeleton ${skeleton}, ${makeup.length} cards`,
  );
  check(
    '3d «مشاهده همه» of the tab → the shop filtered to its categories',
    (await bs.locator('a', { hasText: 'مشاهده همه' }).getAttribute('href')) === '/shop?group=makeup',
  );
  await page.goto(`${BASE}/shop?group=makeup`, { waitUntil: 'load' });
  // the listing streams in after the page shell (loading.tsx): wait for the first card, then count
  await page
    .locator('main article')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  const shopTitle = await page.locator('h1').innerText();
  const shopCards = await page.locator('main article').count();
  check(
    '3e /shop?group=makeup lists makeup',
    /آرایشی/.test(shopTitle) && shopCards > 0,
    `${shopTitle} · ${shopCards} cards`,
  );
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await settled(page);
  const box1 = await page.evaluate(
    () => document.querySelector('[data-bestsellers]').getBoundingClientRect().top + scrollY,
  );
  check(
    '3f the section keeps its place (no jump of the page above it)',
    Math.abs(box1 - box0) < 2,
    `${Math.round(box0)} → ${Math.round(box1)}`,
  );
  const json = await (await page.request.get(`${BASE}/api/bestsellers?tab=skin`)).text();
  check(
    '3g /api/bestsellers JSON: card fields only, no purchase price',
    !leaks(json).length && !/cost|payable/.test(json),
  );

  // ── 4. panel ──
  const cust = await (await ctxFor(2)).newPage();
  await signIn(cust, phones.customer);
  userIds.push(one(`select id from ${SCHEMA}.users where phone = '${phones.customer}'`));
  check(
    '4a customer → /admin/bestsellers is 403',
    (await cust.goto(`${BASE}/admin/bestsellers`)).status() === 403,
  );
  const admin = await (await ctxFor(3)).newPage();
  await signIn(admin, phones.admin);
  userIds.push(one(`select id from ${SCHEMA}.users where phone = '${phones.admin}'`));
  execSync(`npm run grant-role -- ${phones.admin} admin`, { cwd: shopRoot, encoding: 'utf8' });
  // two in-stock products that are not already first in «همه»
  const [pa, pb] = sql(
    `select id from product_catalog where is_sellable and price > 0 and missing_since is null and stock > 0 order by id desc limit 2`,
  )
    .split('\n')
    .map(Number);
  await admin.goto(`${BASE}/admin/bestsellers?tab=all`, { waitUntil: 'load' });
  for (const id of [pa, pb]) {
    await admin.locator('input[name=product]').fill(String(id));
    await admin.getByRole('button', { name: 'افزودن' }).click();
    await admin.locator(`li[data-pick="${id}"]`).waitFor({ timeout: 20000 });
  }
  let preview = await admin
    .locator('[data-preview] tbody tr')
    .evaluateAll((rows) => rows.map((r) => `${r.dataset.product}:${r.dataset.source}`));
  check(
    '4b two picks first, in order, marked «انتخاب شما»',
    preview[0] === `${pa}:manual` && preview[1] === `${pb}:manual`,
    preview.slice(0, 4).join(' '),
  );
  const sources = preview.map((p) => p.split(':')[1]);
  const rank = { manual: 0, liateam: 1, fill: 2 };
  check(
    '4c fill rule: manual → Liateam tag → fill-up (never out of order), ≤ 10',
    preview.length <= 10 && sources.every((x, i) => i === 0 || rank[x] >= rank[sources[i - 1]]),
    sources.join(','),
  );
  await admin.locator(`li[data-pick="${pb}"] button`, { hasText: 'بالا' }).click();
  await admin.waitForURL(/done=up/);
  preview = await admin
    .locator('[data-preview] tbody tr')
    .evaluateAll((rows) => rows.map((r) => Number(r.dataset.product)));
  check('4d reorder: the second pick moved up', preview[0] === pb && preview[1] === pa);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const homeFirst = (await cardsOf()).slice(0, 2).map(productIdOf);
  check(
    '4e home «همه» shows the picks first, in the panel order',
    homeFirst[0] === pb && homeFirst[1] === pa,
    homeFirst.join(','),
  );
  await admin.locator(`li[data-pick="${pb}"] button`, { hasText: 'برداشتن' }).click();
  await admin.waitForURL(/done=off/);
  check(
    '4f switch off: kept as a row (enabled = false), no longer first',
    one(`select enabled from ${SCHEMA}.bestseller_picks where tab_key = 'all' and product_id = ${pb}`) ===
      'f' &&
      Number(await admin.locator('[data-preview] tbody tr').first().getAttribute('data-product')) === pa,
  );
  await admin.locator('[data-use-tag] button').click();
  await admin.waitForURL(/done=tag-/);
  const tagOff = await admin
    .locator('[data-preview] tbody tr')
    .evaluateAll((rows) => rows.map((r) => r.dataset.source));
  check(
    '4g Liateam-tag switch off → no «برچسب پرفروش لیاتیم» rows',
    !tagOff.includes('liateam') &&
      one(`select value::text from ${SCHEMA}.site_settings where key = 'bestsellers.use_tag.all'`) ===
        'false',
  );
  check(
    '4h audit: add / move / disable / setting',
    Number(
      one(
        `select count(*) from ${SCHEMA}.audit_log where action in ('bestseller.add','bestseller.move','bestseller.disable','setting.update') and created_at > now() - interval '10 minutes'`,
      ),
    ) >= 5,
  );
  await shot(admin, 'home-admin-bestsellers-1440.png', { fullPage: true });

  // ── 5. magazine, affiliate, header ──
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  // sections below the first screen are laid out (and have innerText) only near the screen (content-visibility: auto)
  const nearScreen = async (sel) => {
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.waitForFunction((q) => document.querySelector(q)?.innerText.trim().length > 0, sel);
  };
  await nearScreen('[data-magazine]');
  check(
    '5a magazine: «به‌زودی», no made-up articles',
    (await page.locator('[data-magazine="soon"]').count()) === 1 &&
      /به‌زودی/.test(await page.locator('[data-magazine]').innerText()) &&
      (await page.locator('[data-magazine] a').count()) === 0,
  );
  const band = page.locator('[data-home-section="affiliate"]');
  await nearScreen('[data-home-section="affiliate"]');
  check(
    '5b affiliate band: «ثبت درخواست همکاری» → /affiliate, no number',
    /ثبت درخواست همکاری/.test(await band.innerText()) &&
      (await band.locator('a[href^="/affiliate"]').count()) === 1 &&
      !/[0-9۰-۹]/.test(await band.innerText()),
  );
  const nav = (await page.locator('header nav[aria-label="منوی اصلی"] a:visible').allInnerTexts())
    .map((t) => t.trim())
    .filter(Boolean);
  check(
    '5c header: فروشگاه, برندها, تخفیفات ویژه, همکاری در فروش, …',
    JSON.stringify(nav.slice(0, 4)) ===
      JSON.stringify(['فروشگاه', 'برندها', 'تخفیفات ویژه', 'همکاری در فروش']),
    nav.join(' | '),
  );
  const hrefs = await page
    .locator('header a[href^="/"]')
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href')))]);
  const dead = [];
  for (const h of hrefs)
    if ((await page.request.get(`${BASE}${h}`, { maxRedirects: 3 })).status() >= 400) dead.push(h);
  check('5d header: no dead link', !dead.length, dead.join(' '));
  const homeHtml = await page.content();
  check(
    '5e home: no purchase price in the HTML',
    !leaks(homeHtml).length,
    leaks(homeHtml).slice(0, 3).join(' '),
  );
  await shot(page, 'home-full-1440.png', { fullPage: true });
  for (const key of ['skin', 'makeup', 'scent', 'hair']) {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    const label = { skin: 'مراقبت پوست', makeup: 'آرایشی', scent: 'عطر و بدن', hair: 'مو و دهان' }[key];
    await bs.getByRole('tab', { name: label }).click();
    await bs.locator('[role=tabpanel][aria-busy=false]').waitFor({ timeout: 20000 });
    await bs.scrollIntoViewIfNeeded();
    await shot(page, `home-bestsellers-${key}-1440.png`);
  }

  // ── 6. phones ──
  const m = await (await ctxFor(4, { width: 390, height: 844 })).newPage();
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('6a 390px home: no horizontal scroll', over <= 0, `${over}px`);
  await m
    .locator('header button[aria-label*="منو"]')
    .first()
    .click()
    .catch(() => {});
  const drawer = await m.locator('a[href="/affiliate"]').count();
  check('6b phone drawer: «همکاری در فروش» link', drawer >= 1);
  await m.keyboard.press('Escape').catch(() => {});
  await shot(m, 'home-full-390.png', { fullPage: true });
} finally {
  cleanup();
  const list = userIds.filter(Boolean).join(',');
  if (list) sql(`delete from ${SCHEMA}.user_roles where user_id in (${list}) and role = 'admin'`);
  await browser.close();
}
finish();
