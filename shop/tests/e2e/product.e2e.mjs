// Product page end to end against the running app and the local Docker database: every synced section shown in
// Liateam's order, empty sections have no tab, the video only through ArvanCloud's player in a sandboxed iframe,
// reviews (masked names, «هنوز نظری…»), a site review saved as pending (not shown until approved, XSS stripped,
// limits), slug_fa / old links → 301 to slug_en, no horizontal scroll from 390 to 1920, no cost on the page.
// Writes only its own review rows (a fresh user every run) and removes them at the end.
import { BASE, SCHEMA, check, chromium, finish, requireLocalApp, shot, signIn, sql } from './_harness.mjs';

requireLocalApp();
const VISIBLE = `p.is_sellable and p.price > 0 and p.missing_since is null and p.slug_en is not null`;
const one = (q) => sql(q).split('\n')[0] ?? '';

// a product with every section, and one without FAQ and video
const full = Number(
  one(`select p.id from product_catalog p where ${VISIBLE} and p.video_embed_url is not null
         and exists (select 1 from product_faqs f where f.product_id = p.id)
         and exists (select 1 from product_reviews r where r.product_id = p.id)
         and p.how_to_use ~ '[[:alpha:]]' order by p.id limit 1`),
);
const bare = Number(
  one(`select p.id from product_catalog p where ${VISIBLE} and p.video_embed_url is null
         and not exists (select 1 from product_faqs f where f.product_id = p.id) order by p.id limit 1`),
);
check(
  'test data: products with and without FAQ/video exist',
  full > 0 && bare > 0,
  `full ${full}, bare ${bare}`,
);
const slugOf = (id) => one(`select slug_en from product_catalog where id = ${id}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const go = async (path) => {
  const res = await page.goto(BASE + path, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#reviews', { timeout: 60000 }).catch(() => {});
  return res;
};
const tabs = () => page.locator('nav[aria-label="بخش‌های صفحه‌ی محصول"] a').allTextContents();

// ── 1. all sections, in Liateam's order ──
await go(`/p/${slugOf(full)}`);
const t1 = await tabs();
check(
  '1a tabs: intro, specs, how-to-use, FAQ, reviews',
  t1.length === 5 && t1[0] === 'معرفی' && t1[3] === 'پرسش‌های متداول' && t1[4].startsWith('دیدگاه‌ها'),
  t1.join(' | '),
);
for (const id of ['intro', 'specs', 'how', 'faq', 'reviews'])
  check(`1b section #${id} rendered`, (await page.locator(`section#${id}`).count()) === 1);
const dbKeys = sql(`select key from product_attributes where product_id = ${full} order by position`).split(
  '\n',
);
const shownKeys = await page.locator('#specs dt').allTextContents();
check(
  '1c specs: same rows in the same order as the database',
  JSON.stringify(shownKeys) === JSON.stringify(dbKeys),
  `${shownKeys.length} rows`,
);
const dbFaq = one(`select question from product_faqs where product_id = ${full} order by position limit 1`);
const faq = page.locator('#faq details').first();
await faq.locator('summary').click();
check(
  '1d FAQ: first question first, opens on click',
  (await faq.locator('summary').textContent()).trim() === dbFaq && (await faq.getAttribute('open')) !== null,
);
const iframe = page.locator('#intro iframe');
const src = (await iframe.getAttribute('src')) ?? '';
const sandbox = (await iframe.getAttribute('sandbox')) ?? '';
check(
  '1e video: ArvanCloud player only, sandboxed (no top navigation, no forms, no popups)',
  /^https:\/\/player\.arvancloud\.ir\//.test(src) &&
    sandbox &&
    !/top-navigation|allow-forms|allow-popups/.test(sandbox),
  sandbox,
);
const authors = await page.locator('#reviews article header b').allTextContents();
check(
  '1f synced reviews shown with short names («نام ف.»)',
  authors.length > 0 && authors.every((a) => /^\S+ \S\.$|^\S+$|^خریدار$/.test(a.trim())),
  authors.slice(0, 3).join('، '),
);
// width fix: on desktop the description fills the content area (only the video column beside it)
const widths = await page.evaluate(() => {
  const sec = document.querySelector('#intro').getBoundingClientRect().width;
  const prose = document.querySelector('#intro [class*=prose]').getBoundingClientRect().width;
  return { sec, prose };
});
check(
  '1g desktop: description uses the content width (beside the video), no empty strip',
  widths.prose >= widths.sec - 440 - 48 - 2,
  `${Math.round(widths.prose)} of ${Math.round(widths.sec)} px`,
);
await shot(page, 'product-desktop.png', { fullPage: true });

// ── 2. empty sections have no tab ──
await go(`/p/${slugOf(bare)}`);
const t2 = await tabs();
check(
  '2a no FAQ → no FAQ tab or section; no video → no iframe',
  !t2.includes('پرسش‌های متداول') &&
    (await page.locator('#faq').count()) === 0 &&
    (await page.locator('#intro iframe').count()) === 0,
  t2.join(' | '),
);
const bareW = await page.evaluate(() => {
  const sec = document.querySelector('#intro')?.getBoundingClientRect().width ?? 0;
  const prose = document.querySelector('#intro [class*=prose]')?.getBoundingClientRect().width ?? 0;
  return { sec, prose };
});
check(
  '2b desktop without video: description spans the full content width',
  bareW.prose > 0 && bareW.prose >= bareW.sec - 2,
  `${Math.round(bareW.prose)} of ${Math.round(bareW.sec)} px`,
);
const noHow = Number(
  one(
    `select p.id from product_catalog p where ${VISIBLE} and (p.how_to_use is null or p.how_to_use !~ '[[:alpha:]]') limit 1`,
  ) || 0,
);
if (noHow) {
  await go(`/p/${slugOf(noHow)}`);
  check('2c how-to-use empty or only «.» → tab hidden', !(await tabs()).includes('نحوه مصرف'));
}
const noReviews = Number(
  one(`select p.id from product_catalog p where ${VISIBLE}
         and not exists (select 1 from product_reviews r where r.product_id = p.id) limit 1`) || 0,
);
if (noReviews) {
  await go(`/p/${slugOf(noReviews)}`);
  check('2d no reviews → «هنوز نظری ثبت نشده»', (await page.getByText('هنوز نظری ثبت نشده').count()) === 1);
}

// ── 3. nothing internal on the page ──
const html = await (await fetch(`${BASE}/p/${slugOf(full)}`)).text();
const cost = one(`select cost_price from supplier_products where id = ${full}`);
check(
  '3 no cost price on the page (value or field name)',
  !html.includes(cost) && !/cost_price|payable_price|production_price/.test(html),
);

// ── 4. addresses: slug_fa / /p/<id> → 301 → slug_en ──
const name = one(`select name from product_catalog where id = ${full}`);
const fa = `${full}-${name
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 80)}`;
for (const [label, path] of [
  ['old Persian link', `/p/${encodeURI(fa)}`],
  ['bare id', `/p/${full}`],
  ['outdated English slug', `/p/some-old-name-${full}`],
]) {
  const r = await fetch(`${BASE}${path}?sort=price_asc`, { redirect: 'manual' });
  check(
    `4 ${label} → 301 to the English slug (query kept)`,
    r.status === 301 && r.headers.get('location')?.endsWith(`/p/${slugOf(full)}?sort=price_asc`),
    `${r.status} ${r.headers.get('location')}`,
  );
}
const canonical = await page.evaluate(() =>
  document.querySelector('link[rel=canonical]')?.getAttribute('href'),
);
check(
  '4 canonical link = the English slug of the page',
  /^\/p\/[a-z0-9-]+-\d+$/.test(new URL(canonical ?? '/', BASE).pathname) &&
    new URL(canonical ?? '/', BASE).pathname === new URL(page.url()).pathname,
  canonical,
);

// ── 5. review form: guests → login; signed in → pending, hidden until approved ──
await go(`/p/${slugOf(bare)}`);
check(
  '5a guest: «ورود و ثبت دیدگاه» instead of the form',
  (await page.locator('#reviews a[href^="/login"]').count()) === 1 &&
    (await page.locator('#reviews form').count()) === 0,
);
const phone = `0913${String(Date.now()).slice(-7)}`;
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  extraHTTPHeaders: { 'x-real-ip': `10.77.${Date.now() % 250}.${1 + (Date.now() % 200)}` },
});
const m = await ctx.newPage();
await signIn(m, phone);
const userId = one(`select id from ${SCHEMA}.users where phone = '${phone}'`);
await m.goto(`${BASE}/p/${slugOf(bare)}#reviews`, { waitUntil: 'load' });
const form = m.locator('#reviews form');
const send = async () =>
  Promise.all([
    m.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 }).catch(() => {}),
    form.getByRole('button', { name: 'ثبت دیدگاه' }).click(),
  ]);
// validation: no rating, too short
await form.locator('textarea').fill('کوتاه');
await send();
check(
  '5b invalid input → message, nothing stored',
  (await m.locator('#review-error').count()) === 1 &&
    one(`select count(*) from ${SCHEMA}.site_reviews where user_id = ${userId}`) === '0',
);
await form.locator('label[title="خوب"]').click();
const body = 'محصول خوبی بود <script>alert(1)</script><b>واقعاً</b> راضی هستم.';
await form.locator('textarea').fill(body);
await send();
await m.waitForSelector('#reviews [role=status]', { timeout: 15000 }).catch(() => {});
check(
  '5c submitted → «پس از تأیید نمایش داده می‌شود»',
  (await m.getByText('پس از تأیید نمایش داده').count()) === 1,
);
await shot(m, 'product-mobile-review-sent.png');
const row = one(
  `select source || '|' || status || '|' || rating || '|' || body from ${SCHEMA}.site_reviews where user_id = ${userId}`,
);
const [source, status, rating, stored] = row.split('|');
check(
  '5d stored as pending, source = site, rating 4',
  source === 'site' && status === 'pending' && rating === '4',
  row,
);
check('5e markup stripped before storing', !/[<>]/.test(stored) && stored.includes('واقعاً'), stored);
await m.reload({ waitUntil: 'load' });
check('5f pending review is not shown on the page', (await m.getByText('واقعاً راضی').count()) === 0);
await m.locator('#reviews form label[title="عالی"]').click();
await m.locator('#reviews form textarea').fill('یک دیدگاه دیگر برای همین محصول.');
await Promise.all([
  m.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 }).catch(() => {}),
  m.locator('#reviews form').getByRole('button', { name: 'ثبت دیدگاه' }).click(),
]);
check(
  '5g a second review while one is pending → refused',
  (
    await m
      .locator('#review-error')
      .textContent({ timeout: 8000 })
      .catch(() => '')
  ).includes('در انتظار تأیید'),
);
sql(`update ${SCHEMA}.site_reviews set status = 'approved', moderated_at = now() where user_id = ${userId}`);
await m.reload({ waitUntil: 'load' });
check('5h approved → shown on the page', (await m.getByText('واقعاً راضی').count()) === 1);
const anon = await fetch(`${BASE}/p/${slugOf(bare)}`, { method: 'POST', body: 'x' });
check('5i no session → cannot post a review', anon.status >= 400 || !(await anon.text()).includes('ثبت شد'));
sql(`delete from ${SCHEMA}.site_reviews where user_id = ${userId}`);

// ── 6. responsive: no horizontal scroll 390 → 1920, both layouts ──
const overflow = [];
for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  for (const id of [full, bare]) {
    await go(`/p/${slugOf(id)}`);
    const extra = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (extra > 0) overflow.push(`${width}px #${id}: +${extra}`);
  }
}
check(
  '6 no horizontal scroll at 390/768/1024/1280/1440/1920',
  !overflow.length,
  overflow.join(', ') || 'none',
);
await page.setViewportSize({ width: 390, height: 844 });
await go(`/p/${slugOf(full)}`);
await shot(page, 'product-mobile.png', { fullPage: true });

await ctx.close();
await browser.close();
finish();
