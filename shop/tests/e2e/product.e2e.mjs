// Product page end to end against the running app and the local Docker database: every synced section shown in
// Liateam's order, empty sections have no tab, the video only through ArvanCloud's player in a sandboxed iframe,
// reviews (masked names, «هنوز نظری…»), a site review saved as pending (not shown until approved, XSS stripped,
// limits), slug_fa / old links → 301 to slug_en, no horizontal scroll from 390 to 1920, no cost on the page.
// Writes only its own review rows (a fresh user every run) and removes them at the end.
import {
  BASE,
  SCHEMA,
  check,
  chromium,
  finish,
  requireLocalApp,
  shot,
  signIn,
  sql,
  toLatin,
} from './_harness.mjs';

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
await go(`/shop/product/${slugOf(full)}`);

// JSON-LD: valid JSON (no raw «<» that could end the block), the product's name, the shown price (schema.org: rial)
const ldText = await page.locator('script[type="application/ld+json"]').first().textContent();
let ld = null;
try {
  ld = JSON.parse(ldText ?? '');
} catch {}
const shownToman = Number(
  toLatin(
    (
      (await page
        .locator('main article')
        .getByText(/^قیمت /)
        .first()
        .textContent()) ?? ''
    ).split('،')[0],
  ),
);
check(
  '1j JSON-LD parses, no raw < > &, name and price as on the page',
  ld?.['@type'] === 'Product' &&
    !/[<>&]/.test(ldText ?? '') &&
    ld.name === one(`select name from product_catalog where id = ${full}`) &&
    ld.offers?.priceCurrency === 'IRR' &&
    Number(ld.offers?.price) === shownToman * 10,
  `${ld?.name} · ${ld?.offers?.price} rial vs ${shownToman} toman`,
);
const t1 = await tabs();
check(
  '1a tabs: intro, specs, video (this product has one), how-to-use, FAQ, reviews',
  t1.length === 6 &&
    t1[0] === 'معرفی' &&
    t1[2] === 'ویدیو' &&
    t1[4].startsWith('پرسش‌ها') &&
    t1[5].startsWith('دیدگاه‌ها'),
  t1.join(' | '),
);
for (const id of ['intro', 'specs', 'how', 'faq', 'reviews'])
  check(`1b section #${id} rendered`, (await page.locator(`[data-section="${id}"]#${id}`).count()) === 1);
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
// facade: no player before the click
check(
  '1e0 video: a play button, no third-party player loaded yet',
  (await page.locator('figure[data-media=video] iframe').count()) === 0,
);
await page.locator('figure[data-media=video] button').click();
const iframe = page.locator('figure[data-media=video] iframe');
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
// «معرفی» full width; «مشخصات» half width with the video beside it, as tall as the specs column
const layout = await page.evaluate(() => {
  const r = (q) => document.querySelector(q).getBoundingClientRect();
  const intro = r('#intro'),
    specs = r('#specs'),
    media = r('#video');
  return {
    introFull: intro.width > 1000,
    half: Math.abs(specs.width - media.width) < 4 && media.right <= specs.left + 2,
    sameHeight: Math.abs(specs.height - media.height) < 4,
  };
});
check(
  '1g desktop: intro full width, specs | video in halves, same height',
  layout.introFull && layout.half && layout.sameHeight,
  JSON.stringify(layout),
);
await shot(page, 'product-desktop.png', { fullPage: true });

// ── 2. empty sections keep their tab and show an empty state (one template for every product) ──
await go(`/shop/product/${slugOf(bare)}`);
const t2 = await tabs();
check(
  '2a no FAQ → the FAQ tab stays, with «پرسشی … ثبت نشده» + contact link; no video → a photo instead',
  t2.length === 5 &&
    (await page.locator('#faq a[href="/contact"]').count()) === 1 &&
    (await page.locator('figure[data-media=video] iframe').count()) === 0 &&
    (await page.locator('figure[data-media=photo] img').count()) === 1,
  t2.join(' | '),
);
const noHow = Number(
  one(
    `select p.id from product_catalog p where ${VISIBLE} and (p.how_to_use is null or p.how_to_use !~ '[[:alpha:]]') limit 1`,
  ) || 0,
);
if (noHow) {
  await go(`/shop/product/${slugOf(noHow)}`);
  check(
    '2c how-to-use empty or only «.» → tab stays, «اطلاعات تکمیلی … ثبت نشده است»',
    (await tabs()).includes('نحوه مصرف') &&
      (await page.getByText('اطلاعات تکمیلی برای این محصول ثبت نشده است').count()) === 1,
  );
}
const noReviews = Number(
  one(`select p.id from product_catalog p where ${VISIBLE}
         and not exists (select 1 from product_reviews r where r.product_id = p.id) limit 1`) || 0,
);
if (noReviews) {
  await go(`/shop/product/${slugOf(noReviews)}`);
  check('2d no reviews → «اولین نفر باشید»', (await page.getByText('اولین نفر باشید').count()) === 1);
}

// ── 3. nothing internal on the page ──
const html = await (await fetch(`${BASE}/shop/product/${slugOf(full)}`)).text();
const cost = one(`select cost_price from supplier_products where id = ${full}`);
check(
  '3 no cost price on the page (value or field name)',
  !html.includes(cost) && !/cost_price|payable_price|production_price/.test(html),
);

// ── 4. addresses: old /p/… and root links, slug_fa, /<id> → 301 → /shop/product/<slug_en> ──
const name = one(`select name from product_catalog where id = ${full}`);
const fa = `${full}-${name
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 80)}`;
for (const [label, path] of [
  ['old root Persian link', `/${encodeURI(fa)}`],
  ['old root English slug', `/${slugOf(full)}`],
  ['bare id', `/shop/product/${full}`],
  ['Persian slug', `/shop/product/${encodeURI(fa)}`],
  ['outdated English slug', `/shop/product/some-old-name-${full}`],
  ['old /p/ address', `/p/${slugOf(full)}`],
  ['old /p/ Persian link', `/p/${encodeURI(fa)}`],
]) {
  const r = await fetch(`${BASE}${path}?sort=price_asc`, { redirect: 'manual' });
  check(
    `4 ${label} → 301 to the English slug (query kept)`,
    r.status === 301 && r.headers.get('location')?.endsWith(`/shop/product/${slugOf(full)}?sort=price_asc`),
    `${r.status} ${r.headers.get('location')}`,
  );
}
const canonical = await page.evaluate(() =>
  document.querySelector('link[rel=canonical]')?.getAttribute('href'),
);
check(
  '4 canonical link = the English slug of the page',
  /^\/shop\/product\/[a-z0-9-]+-\d+$/.test(new URL(canonical ?? '/', BASE).pathname) &&
    new URL(canonical ?? '/', BASE).pathname === new URL(page.url()).pathname,
  canonical,
);

// ── 5. review form: guests → login; signed in → pending, hidden until approved ──
await go(`/shop/product/${slugOf(bare)}`);
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
await m.goto(`${BASE}/shop/product/${slugOf(bare)}#reviews`, { waitUntil: 'load' });
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
const anon = await fetch(`${BASE}/shop/product/${slugOf(bare)}`, { method: 'POST', body: 'x' });
check('5i no session → cannot post a review', anon.status >= 400 || !(await anon.text()).includes('ثبت شد'));
sql(`delete from ${SCHEMA}.site_reviews where user_id = ${userId}`);

// ── 7. gallery: main photo + thumbnails in Liateam's order; single photo → no thumbnails ──
const multi = Number(
  one(`select p.id from product_catalog p where ${VISIBLE} and p.image_url is not null and p.gallery_count >= 2
         order by p.gallery_count desc, p.id limit 1`) || 0,
);
// Liateam has (almost) no product with a single photo: when none exists, a product's gallery is emptied for the
// check and restored right after (same pattern as the catalog test's price changes).
let single = Number(
  one(`select p.id from product_catalog p where ${VISIBLE} and p.image_url is not null and p.gallery_count = 0
         and (select s.content_hashes ? 'gallery' from supplier_products s where s.id = p.id) order by p.id limit 1`) ||
    0,
);
let restoreGallery = null;
if (!single) {
  single = Number(
    one(
      `select p.id from product_catalog p where ${VISIBLE} and p.image_url is not null and p.id <> ${multi} and p.gallery_count > 0 order by p.id limit 1`,
    ),
  );
  const saved = one(`select gallery_count from supplier_products where id = ${single}`);
  sql(`create table if not exists public.e2e_images_backup as select * from product_images where false`);
  sql(`insert into public.e2e_images_backup select * from product_images where product_id = ${single}`);
  sql(
    `delete from product_images where product_id = ${single}; update supplier_products set gallery_count = 0 where id = ${single}`,
  );
  restoreGallery = () => {
    sql(
      `insert into product_images select * from public.e2e_images_backup where product_id = ${single} on conflict do nothing`,
    );
    sql(
      `update supplier_products set gallery_count = ${saved} where id = ${single}; drop table public.e2e_images_backup`,
    );
  };
}
check(
  '7 test data: products with a gallery and with one photo',
  multi > 0 && single > 0,
  `${multi}, ${single}`,
);
const photosLoaded = () =>
  page
    .waitForFunction(
      () => [...document.querySelectorAll('#gallery img')].every((i) => i.complete && i.naturalWidth > 0),
      null,
      {
        timeout: 60000,
      },
    )
    .catch(() => {});
const optimised = (src) => new URL(src, BASE).searchParams.get('url') ?? src;
const dbImages = [
  one(`select image_url from product_catalog where id = ${multi}`),
  ...sql(`select url from product_images where product_id = ${multi} order by position`).split('\n'),
].filter((u, i, a) => u && a.indexOf(u) === i);
await page.setViewportSize({ width: 1440, height: 900 });
await go(`/shop/product/${slugOf(multi)}`);
const thumbs = page.locator('ul[aria-label="تصاویر محصول"] a');
const thumbSrcs = await thumbs.locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')));
check(
  '7a thumbnails: main photo first, then the gallery in the stored order',
  JSON.stringify(thumbSrcs.map(optimised)) === JSON.stringify(dbImages),
  `${thumbSrcs.length} thumbnails`,
);
const allImgs = await page
  .locator('#gallery img')
  .evaluateAll((imgs) => imgs.map((i) => i.currentSrc || i.src));
check(
  '7b every photo through /_next/image (no hotlink to the supplier)',
  allImgs.every((u) => u.includes('/_next/image') && !u.startsWith('https://s3.')),
);
const bigSrc = () => page.locator('#gallery [class*=stage] img').getAttribute('src');
await thumbs.nth(2).click();
await page
  .waitForFunction(
    (want) =>
      decodeURIComponent(
        document.querySelector('#gallery [class*=stage] img')?.getAttribute('src') ?? '',
      ).includes(want),
    dbImages[2],
    { timeout: 10000 },
  )
  .catch(() => {});
check(
  '7c clicking a thumbnail swaps the large photo (no page load)',
  optimised(await bigSrc()) === dbImages[2] &&
    (await thumbs.nth(2).getAttribute('aria-current')) === 'true' &&
    !page.url().includes('img='),
);
await photosLoaded();
await shot(page, 'gallery-desktop.png', { clip: { x: 0, y: 0, width: 1440, height: 900 } });
// no-JavaScript fallback: the thumbnail links point at ?img=N, and the server renders that photo large
const njHtml = await (await fetch(`${BASE}/shop/product/${slugOf(multi)}?img=2`)).text();
const njStage = /class="[^"]*stage[^"]*"[\s\S]*?<img[^>]*src="([^"]+)"/
  .exec(njHtml)?.[1]
  ?.replace(/&amp;/g, '&');
check(
  '7d without JavaScript: thumbnail links are ?img=N and the server shows that photo',
  njHtml.includes('href="?img=2#gallery"') && optimised(njStage ?? '') === dbImages[1],
  optimised(njStage ?? '-'),
);
await go(`/shop/product/${slugOf(single)}`);
check(
  '7e one photo → no thumbnail strip',
  (await page.locator('ul[aria-label="تصاویر محصول"]').count()) === 0 &&
    (await page.locator('#gallery [class*=stage] img').count()) === 1,
);
restoreGallery?.();
const gHtml = await (await fetch(`${BASE}/shop/product/${slugOf(multi)}`)).text();
check(
  '7f no cost price in the gallery page output',
  !gHtml.includes(one(`select cost_price from supplier_products where id = ${multi}`)) &&
    !/cost_price|payable_price|production_price/.test(gHtml),
);
await page.setViewportSize({ width: 390, height: 844 });
await go(`/shop/product/${slugOf(multi)}`);
await photosLoaded();
await shot(page, 'gallery-mobile.png');

// ── 6. responsive: no horizontal scroll 390 → 1920, both layouts ──
const overflow = [];
for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  for (const id of [full, bare, multi]) {
    await go(`/shop/product/${slugOf(id)}`);
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
await go(`/shop/product/${slugOf(full)}`);
await shot(page, 'product-mobile.png', { fullPage: true });

await ctx.close();
await browser.close();
finish();
