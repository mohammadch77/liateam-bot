// Discounts end to end (local app + Docker DB): before any discount the home section says «به‌زودی» and /offers is
// empty; a customer gets 403 on the admin pages; an admin creates a campaign and discounts from the panel (a too-big
// one is refused with «تخفیف بیش از حد مجاز است», no number; the preview shows the products), then the struck-through
// price shows on the product page, the card, /offers and the home rail (with the campaign countdown), the header has
// the «تخفیفات ویژه» link and the campaign bar; no purchase price or Liateam discount in any HTML / JSON; an ended
// discount disappears by itself; phones without horizontal scroll. Removes its discounts, campaign and roles.
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
  sleep,
  toLatin,
} from './_harness.mjs';

requireLocalApp();
const one = (q) => sql(q).split('\n')[0] ?? '';
const stamp = String(Date.now()).slice(-6);
const phones = { admin: `0915${stamp}1`, customer: `0915${stamp}2` };
const LABEL = `e2e-${stamp}`;
const PRODUCT = 426;
const CATEGORY = Number(one(`select category[1] from product_catalog where id = 160`));
const VISIBLE = 'is_sellable and price > 0 and missing_since is null and slug_en is not null';
const slugOf = (id) => one(`select slug_en from product_catalog where id = ${id}`);
const priceOf = (id) => Number(one(`select price from product_catalog where id = ${id}`));
// the owner's view (the test runs as the database owner; the shop never can)
const costs = new Map(
  sql(`select id || ':' || coalesce(cost_price, 0) from product_catalog where is_sellable and price > 0`)
    .split('\n')
    .map((l) => l.split(':').map(Number)),
);
const costOf = (id) => costs.get(id) ?? 0;
const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
const cleanup = () => {
  sql(`delete from ${SCHEMA}.shop_discounts where label like 'e2e-%'`);
  sql(`delete from ${SCHEMA}.campaigns where title like 'e2e-%'`);
};

const browser = await chromium.launch();
const ctxFor = (n, viewport = { width: 1440, height: 900 }) =>
  browser.newContext({ viewport, extraHTTPHeaders: { 'x-real-ip': `10.89.${n}.${1 + (Date.now() % 200)}` } });
const userIds = [];
/** The purchase price of these products must appear nowhere in the text (Persian or Latin digits, with or without separators). */
function leaks(text, ids) {
  const found = [];
  for (const id of ids) {
    const c = costOf(id);
    if (!c) continue;
    for (const form of [String(c), fa(c), c.toLocaleString('en-US')])
      if (text.includes(form)) found.push(`${id}:${form}`);
  }
  for (const word of ['cost_price', 'payable_price', 'discount_price', 'extra_retail', 'base_retail'])
    if (text.includes(word)) found.push(word);
  return found;
}

try {
  cleanup();
  const anon = await (await ctxFor(1)).newPage();
  const leftover = Number(one(`select count(*) from ${SCHEMA}.shop_discounts where active`));

  // ── 1. before ──
  await anon.goto(`${BASE}/`, { waitUntil: 'load' });
  const headerLink = await anon.locator('header a[href="/offers"]').count();
  check('1a header: «تخفیفات ویژه» link to /offers', headerLink >= 1);
  if (leftover === 0) {
    check(
      '1b home: «تخفیفات ویژه» section keeps its place with «به‌زودی»',
      (await anon.locator('[data-offers="soon"]').count()) === 1 &&
        (await anon.locator('[data-offers] >> text=به‌زودی').count()) >= 1,
    );
    await shot(anon, 'offers-home-soon-1440.png');
    await anon.goto(`${BASE}/offers`, { waitUntil: 'load' });
    check('1c /offers empty state', (await anon.getByText('فعلاً محصول تخفیف‌داری نداریم').count()) === 1);
    check('1d no campaign bar without a campaign', (await anon.locator('[data-campaign-bar]').count()) === 0);
  } else check('1b (skipped: other active discounts exist)', true, `${leftover}`);

  // ── 2. a customer cannot reach the panel ──
  const cust = await (await ctxFor(2)).newPage();
  await signIn(cust, phones.customer);
  userIds.push(one(`select id from ${SCHEMA}.users where phone = '${phones.customer}'`));
  for (const path of ['/admin/discounts', '/admin/campaigns']) {
    const res = await cust.goto(`${BASE}${path}`);
    check(`2 customer → ${path} is 403`, res.status() === 403, `status ${res.status()}`);
  }

  // ── 3. admin: campaign and discounts ──
  const adminCtx = await ctxFor(3);
  const admin = await adminCtx.newPage();
  await signIn(admin, phones.admin);
  userIds.push(one(`select id from ${SCHEMA}.users where phone = '${phones.admin}'`));
  execSync(`npm run grant-role -- ${phones.admin} admin`, { cwd: shopRoot, encoding: 'utf8' });

  await admin.goto(`${BASE}/admin/campaigns`, { waitUntil: 'load' });
  const ends = new Date(Date.now() + 2 * 86400_000 + 3.5 * 3600_000).toISOString().slice(0, 16);
  await admin.locator('input[name=title]').fill(`${LABEL} جشنواره`);
  await admin.locator('input[name=bannerText]').fill('جشنواره آزمایشی · تا دو روز دیگر');
  await admin.locator('input[name=endsAt]').fill(ends);
  await admin.getByRole('button', { name: 'ساخت کمپین' }).click();
  await admin.getByText('کمپین ساخته شد.').waitFor({ timeout: 20000 });
  const campaignId = one(`select id from ${SCHEMA}.campaigns where title = '${LABEL} جشنواره'`);
  check('3a campaign created from the panel', !!campaignId, campaignId);

  await admin.goto(`${BASE}/admin/discounts`, { waitUntil: 'load' });
  const form = admin.locator('form[aria-labelledby="discount-form-title"]');
  /** waits for the form's success message; on failure shows what the form says instead */
  const saved_ = async (text) => {
    try {
      await form.getByText(text).waitFor({ timeout: 20000 });
    } catch (e) {
      console.log(
        'form says:',
        (await form.locator('[role=alert], [role=status]').allInnerTexts()).join(' | '),
      );
      throw e;
    }
  };
  const fillDiscount = async ({ scope, target, kind = 'percent', value, campaign = '' }) => {
    await form.locator('select[name=scope]').selectOption(scope);
    if (target !== undefined) await form.locator('input[name=target]').fill(String(target));
    await form.locator('select[name=kind]').selectOption(kind);
    await form.locator('input[name=value]').fill(String(value));
    await form.locator('input[name=label]').fill(LABEL);
    await form.locator('select[name=campaign]').selectOption(campaign);
  };
  // too big: under the purchase price → refused, no number in the message
  await fillDiscount({ scope: 'product', target: PRODUCT, value: 25 });
  await form.getByRole('button', { name: 'ساخت تخفیف' }).click();
  const refusal = form
    .locator('[role=alert], [class*=alert]')
    .filter({ hasText: 'تخفیف بیش از حد مجاز است' });
  await refusal.first().waitFor({ timeout: 20000 });
  const refusalText = await refusal.first().innerText();
  check(
    '3b too-big discount refused: «تخفیف بیش از حد مجاز است», no number in it',
    !/[0-9۰-۹]/.test(refusalText) &&
      Number(one(`select count(*) from ${SCHEMA}.shop_discounts where label = '${LABEL}'`)) === 0,
    refusalText,
  );
  // preview of a safe one
  await fillDiscount({ scope: 'product', target: PRODUCT, value: 3, campaign: campaignId });
  await form.getByRole('button', { name: 'پیش‌نمایش اثر' }).click();
  await form.locator('[data-preview]').waitFor({ timeout: 20000 });
  const preview = await form.locator('[data-preview]').innerText();
  const p426 = priceOf(PRODUCT);
  const final426 = Math.ceil((p426 * 0.97) / 100) * 100;
  check(
    '3c preview: 1 product, Liateam price and the discounted one (no purchase price)',
    /۱ محصول/.test(preview) &&
      preview.includes(fa(p426)) &&
      preview.includes(fa(final426)) &&
      !leaks(preview, [PRODUCT]).length,
    preview.replace(/\s+/g, ' ').slice(0, 160),
  );
  await form.getByRole('button', { name: 'ساخت تخفیف' }).click();
  await saved_('تخفیف ساخته شد.');
  // a category one too (2%), without a campaign
  await admin.goto(`${BASE}/admin/discounts`, { waitUntil: 'load' });
  await fillDiscount({ scope: 'category', target: CATEGORY, value: 2 });
  await form.getByRole('button', { name: 'ساخت تخفیف' }).click();
  await saved_('تخفیف ساخته شد.');
  const saved = sql(
    `select scope || ':' || coalesce(target_code::text, '') || ':' || value from ${SCHEMA}.shop_discounts where label = '${LABEL}' order by id`,
  );
  check('3d two discounts saved', saved.split('\n').length === 2, saved.replace(/\n/g, ' '));
  const audit = Number(
    one(
      `select count(*) from ${SCHEMA}.audit_log where action in ('discount.create', 'campaign.create') and created_at > now() - interval '10 minutes'`,
    ),
  );
  check('3e audit: campaign.create + discount.create', audit >= 3, `${audit}`);
  await shot(admin, 'offers-admin-1440.png', { fullPage: true });

  // ── 4. the storefront ──
  await anon.goto(`${BASE}/p/${slugOf(PRODUCT)}`, { waitUntil: 'load' });
  const buy = anon.locator('aside[aria-label="خرید"]');
  const del = toLatin(
    (await buy
      .locator('del')
      .first()
      .innerText()
      .catch(() => '')) || '',
  );
  const now = toLatin(await buy.locator('b').first().innerText());
  check(
    '4a product page: Liateam price struck through, the discounted price in front',
    Number(del) === p426 && Number(now) === final426,
    `${del} → ${now}`,
  );
  const pageHtml = await anon.content();
  check(
    '4b product page: no purchase price / Liateam discount in the HTML',
    !leaks(pageHtml, [PRODUCT]).length,
    leaks(pageHtml, [PRODUCT]).join(' '),
  );
  await shot(anon, 'offers-product-1440.png');

  await anon.goto(`${BASE}/offers`, { waitUntil: 'load' });
  const cards = await anon.locator('main article').count();
  const catCount = Number(
    one(
      `select count(*) from product_catalog p where ${VISIBLE} and p.category && array(with recursive t(c) as (select ${CATEGORY} union select code from categories x join t on x.parent_code = t.c) select c from t)`,
    ),
  );
  check(
    '4c /offers lists the discounted products',
    cards >= 1 && cards <= 20,
    `${cards} cards (category has ${catCount})`,
  );
  const first = anon.locator('main article').first();
  check(
    '4d /offers card: struck-through price and a percent ribbon',
    (await first.locator('del').count()) === 1 && /٪/.test(await first.innerText()),
  );
  const ids = sql(`select id from product_catalog where ${VISIBLE} limit 400`).split('\n').map(Number);
  const offersHtml = await anon.content();
  check(
    '4e /offers: no purchase price in the HTML',
    !leaks(offersHtml, ids).length,
    leaks(offersHtml, ids).slice(0, 4).join(' '),
  );
  await anon.goto(`${BASE}/offers?sort=cheapest`);
  const cheap = (await anon.locator('main article [class*=current] b').allInnerTexts())
    .map((t) => Number(toLatin(t)))
    .filter(Boolean);
  check(
    '4f sort «ارزان‌ترین» ascending',
    cheap.every((v, i) => i === 0 || v >= cheap[i - 1]),
    cheap.slice(0, 5).join(','),
  );
  await anon.goto(`${BASE}/offers?campaign=${campaignId}`);
  check('4g campaign filter: only the campaign product', (await anon.locator('main article').count()) === 1);
  await anon.goto(`${BASE}/offers`);
  await shot(anon, 'offers-page-1440.png', { fullPage: true });

  await anon.goto(`${BASE}/`, { waitUntil: 'load' });
  check(
    '4h home: the section shows the discounted products and the campaign countdown',
    (await anon.locator('[data-offers="on"] li').count()) >= 1 &&
      (await anon.locator('[data-offers="on"] [role=timer]').count()) === 1,
  );
  await anon.waitForTimeout(1500);
  check(
    '4i countdown ticking (no «--» after load)',
    !/--/.test(await anon.locator('[role=timer]').innerText()),
  );
  check(
    '4j header: campaign bar with the panel text',
    /جشنواره آزمایشی/.test(await anon.locator('[data-campaign-bar]').innerText()),
  );
  const homeHtml = await anon.content();
  check('4k home: no purchase price in the HTML', !leaks(homeHtml, ids).length);
  await shot(anon, 'offers-home-1440.png');
  const suggest = await (
    await anon.request.get(`${BASE}/api/search/suggest?q=${encodeURIComponent('سرم')}`)
  ).text();
  check('4l search JSON: no purchase price / internal price fields', !leaks(suggest, ids).length);

  // ── 5. phones ──
  const m = await (await ctxFor(4, { width: 390, height: 844 })).newPage();
  for (const path of ['/', '/offers', `/p/${slugOf(PRODUCT)}`]) {
    await m.goto(`${BASE}${path}`, { waitUntil: 'load' });
    const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`5 390px ${path}: no horizontal scroll`, over <= 0, `${over}px`);
  }
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  await m.locator('[data-offers]').scrollIntoViewIfNeeded();
  await shot(m, 'offers-home-390.png');
  await m.goto(`${BASE}/offers`, { waitUntil: 'load' });
  await shot(m, 'offers-page-390.png', { fullPage: true });

  // ── 6. an ended discount disappears by itself (cache lives at most 30 s) ──
  sql(
    `update ${SCHEMA}.shop_discounts set ends_at = now(), starts_at = least(starts_at, now() - interval '1 minute') where label = '${LABEL}' and scope = 'product'`,
  );
  await sleep(31_000);
  await anon.goto(`${BASE}/p/${slugOf(PRODUCT)}`, { waitUntil: 'load' });
  check("6 ended discount: product page back to Liateam's price", (await buy.locator('del').count()) === 0);
} finally {
  cleanup();
  const list = userIds.filter(Boolean).join(',');
  if (list) sql(`delete from ${SCHEMA}.user_roles where user_id in (${list}) and role = 'admin'`);
  await browser.close();
}
finish();
