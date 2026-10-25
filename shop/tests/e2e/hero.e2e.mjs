// Home hero slider end to end against the running app and the local Docker database (public.hero_slides, filled
// by the sync bot / `npm run hero:refresh -- --file test/fixtures/home/home.rsc.txt`): slides in DB order, each
// linking to its destination (product → English slug, category → its page), photos through our optimiser as WebP,
// keyboard navigation, autoplay paused on hover/focus, no horizontal scroll 390–1920, a slide whose destination
// disappears is left out, and the static hero when there are no slides. Flips target codes and restores them.
import { BASE, check, chromium, fa, finish, requireLocalApp, shot, sleep, sql } from './_harness.mjs';

requireLocalApp();
const VISIBLE = `p.is_sellable and p.price > 0 and p.missing_since is null`;
const expected = sql(
  `select coalesce(string_agg(case when h.target_type = 'product' then 'p:' || coalesce(p.slug_en, h.target_code::text)
                                   else 'c:' || h.target_code end, ' ' order by h.position), '')
     from hero_slides h
     left join product_catalog p on h.target_type = 'product' and p.id = h.target_code and ${VISIBLE}
     left join categories c on h.target_type = 'category' and c.code = h.target_code and c.in_source
    where p.id is not null or c.code is not null`,
)
  .split(' ')
  .filter(Boolean);
if (!expected.length) {
  console.error(
    'no hero slides in the local DB: run `npm run hero:refresh -- --file test/fixtures/home/home.rsc.txt` in the repo root',
  );
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const slider = page.locator('section[aria-roledescription="اسلایدر"]');
const links = slider.locator('a[data-hero-link]');
const current = () => slider.locator('button[aria-current="true"]').getAttribute('aria-label');
const home = async () => {
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('main h1', { state: 'attached', timeout: 60000 });
};

try {
  // ── 1. slides and links ──
  await home();
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const want = expected.map((e) => (e[0] === 'p' ? `/${e.slice(2)}` : `/c/${e.slice(2)}`)); // p:<slug_en> → /<slug>, c:<code> → /c/<code>-…
  check(
    '1a one slide per DB row with a live destination, in DB order',
    hrefs.length === expected.length &&
      hrefs.every((h, i) =>
        want[i].startsWith('/c/') ? h.startsWith(want[i] + '-') || h === want[i] : h === want[i],
      ),
    `${hrefs.length} slides; first ${hrefs[0]}`,
  );
  check(
    '1b product slides link to the English slug',
    hrefs.filter((h) => !h.startsWith('/c/')).every((h) => /^\/[a-z0-9-]+-\d+$/.test(h)),
    hrefs
      .filter((h) => !h.startsWith('/c/'))
      .slice(0, 2)
      .join(' '),
  );
  check(
    '1c category slides link to the category page',
    hrefs.filter((h) => h.startsWith('/c/')).every((h) => /^\/c\/\d+-/.test(decodeURIComponent(h))),
  );
  check('1d the page still has one h1', (await page.locator('h1').count()) === 1);

  // ── 2. photos through our optimiser, WebP ──
  const img = slider.locator('img').first();
  const src = await img.evaluate((el) => el.currentSrc);
  const srcsets = await slider.locator('source').evaluateAll((ss) => ss.map((s) => s.getAttribute('srcset')));
  check(
    '2a photos from /_next/image only (wide <source> and tall <img>)',
    src.includes('/_next/image?url=') &&
      srcsets.every((s) => s.includes('/_next/image?url=https%3A%2F%2Fs3.liateam.ir')),
    src.slice(0, 90),
  );
  const res = await page.request.get(src, { headers: { Accept: 'image/webp,image/*' } });
  check(
    '2b served as WebP',
    res.ok() && res.headers()['content-type'] === 'image/webp',
    res.headers()['content-type'],
  );
  check('2c desktop shows the wide banner', /slider%2Fimage%2F/.test(src));

  // ── 3. keyboard, autoplay paused on hover/focus ──
  await page.mouse.move(5, 5);
  await slider.locator('li:not([inert]) a').focus();
  await page.keyboard.press('Home');
  await sleep(900);
  const start = await current();
  await page.keyboard.press('ArrowLeft');
  await sleep(900);
  const afterKey = await current();
  check(
    '3a ← moves to the next slide (RTL)',
    start === 'اسلاید ۱' && afterKey === 'اسلاید ۲',
    `${start} → ${afterKey}`,
  );
  await page.keyboard.press('ArrowRight');
  await sleep(900);
  check('3b → moves back', (await current()) === 'اسلاید ۱');
  check(
    '3c only the visible slide is focusable (others inert)',
    (await slider.locator('li[inert]').count()) === expected.length - 1,
  );
  await slider.locator('ol button').last().click();
  await sleep(1500);
  const jumped = await current();
  await slider.locator('ol button').first().click();
  await sleep(1500);
  check(
    '3g a dot jumps straight to its slide',
    jumped === `اسلاید ${fa(expected.length)}` && (await current()) === 'اسلاید ۱',
    jumped,
  );
  await slider.locator('li:not([inert]) a').focus();
  await sleep(7000); // focus inside: no autoplay
  check('3d focus pauses autoplay', (await current()) === 'اسلاید ۱');
  await page.locator('footer a').first().focus();
  await slider.hover();
  await sleep(7000);
  check('3e hover pauses autoplay', (await current()) === 'اسلاید ۱');
  await page.mouse.move(5, 5);
  await page
    .waitForFunction(
      () =>
        document
          .querySelector('section[aria-roledescription] button[aria-current="true"]')
          ?.getAttribute('aria-label') !== 'اسلاید ۱',
      null,
      { timeout: 12000 },
    )
    .catch(() => {});
  check('3f otherwise it advances by itself', (await current()) !== 'اسلاید ۱', await current());
  await shot(page, 'hero-desktop-1440.png');

  // ── 4. a click goes to the slide's destination ──
  await slider.locator('li:not([inert]) a').focus();
  await page.keyboard.press('Home');
  await sleep(900);
  await Promise.all([page.waitForURL((u) => u.pathname !== '/', { timeout: 60000 }), links.first().click()]);
  check(
    '4a clicking a slide opens its destination',
    decodeURIComponent(new URL(page.url()).pathname).startsWith(decodeURIComponent(hrefs[0])),
    new URL(page.url()).pathname,
  );

  // ── 5. responsive: no horizontal scroll, tall banner on phones ──
  for (const width of [390, 768, 1024, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await home();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const box = await slider.boundingBox();
    check(
      `5 ${width}px: no horizontal scroll, slider inside the viewport`,
      over <= 0 && box.x >= 0 && box.x + box.width <= width + 0.5,
      `overflow ${over}px, slider ${Math.round(box.width)}px`,
    );
    if (width === 390) {
      const phone = await slider
        .locator('img')
        .first()
        .evaluate((el) => el.currentSrc);
      check('5b 390px shows the tall banner', /portrait-image/.test(phone));
      await shot(page, 'hero-mobile-390.png');
    }
    if (width === 1920) await shot(page, 'hero-desktop-1920.png');
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ── 6. destination gone → slide left out; no slides → the static hero ──
  const first = sql(`select position from hero_slides order by position limit 1`);
  sql(`update hero_slides set target_code = -target_code where position = ${first}`);
  await home();
  check(
    '6a a slide whose product/category is gone is left out',
    (await links.count()) === expected.length - 1,
  );
  sql(`update hero_slides set target_code = -target_code where target_code > 0`);
  await home();
  check(
    '6b no slides: the static hero, not an empty slider',
    (await slider.count()) === 0 && (await page.locator('#hero-title').count()) === 1,
  );
} finally {
  sql(`update hero_slides set target_code = abs(target_code) where target_code < 0`);
  await browser.close();
}
finish();
