// Product page template end to end on three sample products — rich (426: video, 53 FAQs, long text), medium
// (160) and low-data (520: no FAQ, no summary) — plus one without a video and one without size/country: the same
// five tabs and sections, brand/size/country only in the information column (rows hidden when missing), no
// «آخرین به‌روزرسانی» in the buy box, no purple feature box in «معرفی», intro full width, specs | video (or photo)
// in halves, «نمایش بیشتر» on long text, the phone order and accordion, sticky buy bar, no horizontal scroll at
// 390–1920 px. Read-only.
import { BASE, check, chromium, finish, shot, sql } from './_harness.mjs';

const ids = { rich: 426, medium: 160, low: 520 };
const slug = (id) => sql(`select slug_en from product_catalog where id = ${id}`);
const VISIBLE = `is_sellable and price > 0 and missing_since is null and slug_en is not null`;
const noVideo = Number(
  sql(
    `select id from product_catalog where ${VISIBLE} and video_embed_url is null and id not in (160, 520) order by id limit 1`,
  ),
);
// no size/country: none in the data today (country is always «ایران»), so the hidden-row case is checked on a
// product without a size if one exists
const noSize = Number(
  sql(`select id from product_catalog where ${VISIBLE} and measurement_value is null order by id limit 1`) ||
    0,
);
// a video adds its own tab and section after «مشخصات» (426 has one; 160 and 520 do not)
const withVideo = (id) =>
  sql(`select video_embed_url is not null from product_catalog where id = ${id}`) === 't';
const TABS = (v) => ['معرفی', 'مشخصات', ...(v ? ['ویدیو'] : []), 'نحوه مصرف', 'پرسش‌ها', 'دیدگاه‌ها'];
const SECTIONS = (v) => ['intro', 'specs', ...(v ? ['video'] : []), 'how', 'faq', 'reviews'];

const browser = await chromium.launch();
const open = async (page, id) => {
  await page.goto(`${BASE}/shop/product/${slug(id)}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('[data-section="reviews"]', { timeout: 60000 });
};
const heights = { desktop: {}, mobile: {} };

try {
  // ── desktop ──
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [kind, id] of Object.entries(ids)) {
    await open(d, id);
    const tabs = (await d.locator('nav[aria-label="بخش‌های صفحه‌ی محصول"] a').allInnerTexts()).map((t) =>
      t.replace(/\s*\(.*\)$/, '').trim(),
    );
    check(
      `1 ${kind} (${id}): the same five tabs`,
      JSON.stringify(tabs) === JSON.stringify(TABS(withVideo(id))),
      tabs.join(' | '),
    );
    const sections = await d
      .locator('[data-section]')
      .evaluateAll((els) => els.map((e) => e.dataset.section));
    check(
      `1 ${kind}: the same sections in the same order (+ «ویدیو» only with a video)`,
      JSON.stringify(sections) === JSON.stringify(SECTIONS(withVideo(id))),
    );
    const visible = await d
      .locator('[data-section] > div')
      .evaluateAll((els) => els.every((e) => e.getBoundingClientRect().height > 0));
    check(`1 ${kind}: desktop shows every section open`, visible);
    const cols = await d.evaluate(() =>
      ['[class*=gallery]', '[class*=info]', 'aside[aria-label="خرید"]'].map((q) =>
        Math.round(document.querySelector(`article ${q}`)?.getBoundingClientRect().top ?? -1),
      ),
    );
    check(
      `1 ${kind}: top in three columns (gallery | information | buy box)`,
      cols.every((t) => t > 0 && Math.abs(t - cols[0]) < 40),
      cols.join(','),
    );
    const quick = await d.locator('[class*=info] dl[aria-label="مشخصات سریع"] dt').allInnerTexts();
    check(
      `1 ${kind}: brand, size, country in the information column`,
      ['برند', 'حجم', 'کشور سازنده'].every((k) => quick.includes(k)),
      quick.join(' | '),
    );
    const raw = (await d.locator('main').innerText()).match(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi);
    check(`1 ${kind}: no raw HTML entity on the page`, !raw, raw?.slice(0, 5).join(' '));
    const buy = await d.locator('aside[aria-label="خرید"]').innerText();
    check(
      `1 ${kind}: buy box without «به‌روزرسانی», with the trust lines`,
      !/به‌روز/.test(buy) && /ضمانت اصالت کالا/.test(buy) && /ارسال به سراسر ایران/.test(buy),
    );
    check(
      `1 ${kind}: no feature box / chips in «معرفی»`,
      (await d
        .locator('#intro [class*=lead], #intro [class*=chips], #intro [aria-label="ویژگی‌ها"]')
        .count()) === 0,
    );
    const lay = await d.evaluate(() => {
      const r = (q) => document.querySelector(q)?.getBoundingClientRect();
      const intro = r('#intro'),
        specs = r('#specs'),
        media = r('#video') ?? r('figure[data-media]');
      return {
        introFull: intro.width > 1000,
        half: !!media && Math.abs(specs.width - media.width) < 4,
        sameHeight: !!media && Math.abs(specs.height - media.height) < 4,
        order: [...document.querySelectorAll('[data-section]')].map((e) =>
          Math.round(e.getBoundingClientRect().top),
        ),
      };
    });
    check(
      `1 ${kind}: intro full width, specs | media in halves and the same height`,
      lay.introFull && lay.half && lay.sameHeight,
      JSON.stringify(lay),
    );
    check(
      `1 ${kind}: rating line (٪ · دیدگاه · پرسش)`,
      /٪ پیشنهاد/.test(await d.locator('main p a[href="#reviews"]').first().innerText()) &&
        (await d.locator('main p a[href="#faq"]').count()) === 1,
    );
    heights.desktop[kind] = await d.evaluate(() => document.documentElement.scrollHeight);
    if (kind === 'rich') {
      check(
        '2a rich: long description folded with «نمایش بیشتر»',
        (await d.locator('#intro').getByText('نمایش بیشتر').count()) === 1,
      );
      const faqShown = await d.locator('#faq details:not([class*=more] details):visible').count();
      check(
        '2b rich: 5 FAQs + «نمایش همه‌ی ۵۳ پرسش»',
        (await d.getByText(/نمایش همه‌ی ۵۳ پرسش/).count()) === 1,
        `${faqShown} visible`,
      );
      // the player loads only when asked for (facade): nothing from ArvanCloud before the click
      const playerBefore = await d.locator('figure[data-media=video] iframe').count();
      await d.locator('figure[data-media=video] button').click();
      check(
        '2c rich: video beside the specs — a play button first, then the ArvanCloud player, sandboxed',
        playerBefore === 0 &&
          (await d
            .locator('figure[data-media=video] iframe[src^="https://player.arvancloud.ir/"][sandbox]')
            .count()) === 1,
      );
      const heads = await d.evaluate(() => {
        const t = (q) => document.querySelector(q)?.getBoundingClientRect();
        const sp = t('#specs h2'),
          vi = t('#video h2'),
          specs = t('#specs'),
          video = t('#video');
        return {
          title: document.querySelector('#video h2')?.textContent,
          level: !!sp && !!vi && Math.abs(sp.top - vi.top) < 2 && Math.abs(sp.height - vi.height) < 2,
          sameHeight: !!specs && !!video && Math.abs(specs.height - video.height) < 4,
          player:
            document.querySelector('#video figure[data-media=video]')?.getBoundingClientRect().height ?? 0,
        };
      });
      check(
        '2c rich: «ویدیو معرفی محصول» heading level with «مشخصات», the same height, player filling it',
        heads.title === 'ویدیو معرفی محصول' && heads.level && heads.sameHeight && heads.player >= 280,
        JSON.stringify(heads),
      );
      await d.locator('nav[data-tabs] a[href="#video"]').click();
      await d.waitForFunction(() => location.hash === '#video');
      await d.waitForTimeout(600);
      const onVideo = await d.evaluate(() => ({
        top: Math.round(document.getElementById('video').getBoundingClientRect().top),
        current: document.querySelector('nav[data-tabs] a[aria-current]')?.getAttribute('href'),
      }));
      check(
        '2c rich: the «ویدیو» tab scrolls to the video and is marked current',
        onVideo.top >= 0 && onVideo.top < 140 && onVideo.current === '#video',
        JSON.stringify(onVideo),
      );
      await d.evaluate(() => window.scrollTo(0, 0));
      check(
        '2d rich: «همه‌ی مشخصات» after 8 rows',
        (await d.locator('#specs > div > dl > div').count()) === 8 &&
          (await d.getByText(/همه‌ی مشخصات/).count()) === 1,
      );
      check(
        '2e rich: 4 reviews + «مشاهده‌ی همه‌ی دیدگاه‌ها»',
        (await d.locator('#reviews [class*=reviewsGrid] > [class*=reviewList] > article').count()) === 4 &&
          (await d.getByText(/مشاهده‌ی همه‌ی دیدگاه‌ها/).count()) === 1,
      );
      const before = await d.locator('#specs').evaluate((e) => e.getBoundingClientRect().top);
      await d.locator('#intro').getByText('نمایش بیشتر').click();
      const unfolded = await d
        .locator('#intro [class*=fold] > [class*=foldBody]')
        .first()
        .evaluate((e) => e.scrollHeight <= e.clientHeight + 2);
      const after = await d.locator('#specs').evaluate((e) => e.getBoundingClientRect().top);
      check(
        '2f «نمایش بیشتر» unfolds the whole text, «نمایش کمتر» shown',
        unfolded && after > before && (await d.locator('#intro').getByText('نمایش کمتر').isVisible()),
      );
    }
    if (kind === 'low') {
      check(
        '3a low: FAQ empty state + contact link',
        (await d.locator('#faq a[href="/contact"]').count()) === 1 &&
          (await d.getByText('پرسشی برای این محصول ثبت نشده است').count()) === 1,
      );
      check(
        '3b low: photo beside the specs (no video)',
        (await d.locator('figure[data-media=photo] img').count()) === 1 &&
          (await d.locator('figure[data-media=video]').count()) === 0,
      );
    }
    check(
      `3 ${kind}: our general care note under «نحوه مصرف»`,
      (await d.locator('#how [role=note]').count()) === 1,
    );
    await d.evaluate(() => window.scrollTo(0, 0));
    await shot(d, `layout-${kind}-1440.png`, { fullPage: true });
  }
  // one more product without a video, and one without a size (its row hidden, never «نامشخص»/«—»)
  await open(d, noVideo);
  check(
    `3c no video (${noVideo}): a photo beside the specs`,
    (await d.locator('figure[data-media=photo] img').count()) === 1 &&
      (await d.locator('iframe').count()) === 0,
  );
  check(
    `3c no video (${noVideo}): no «ویدیو» tab, section or heading (the photo has no label)`,
    (await d.locator('nav[data-tabs] a[href="#video"]').count()) === 0 &&
      (await d.locator('#video').count()) === 0 &&
      (await d.getByText('ویدیو معرفی محصول').count()) === 0 &&
      (await d.locator('figure[data-media=photo] figcaption').count()) === 0,
  );
  if (noSize) {
    await open(d, noSize);
    const q = await d.locator('dl[aria-label="مشخصات سریع"]').innerText();
    const hasSize = /حجم/.test(q);
    check(
      `3d without size in the data (${noSize}): no empty rows; size only when found in the specs/name`,
      !/—|نامشخص/.test(q) && (!hasSize || /[۰-۹]+ (میلی‌لیتر|گرم)/.test(q)),
      q.replace(/\s+/g, ' '),
    );
  }
  const dh = Object.values(heights.desktop);
  check(
    '4a desktop heights in a close range (max ≤ 1.25 × min)',
    Math.max(...dh) <= 1.25 * Math.min(...dh),
    JSON.stringify(heights.desktop),
  );

  // ── phone ──
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const [kind, id] of Object.entries(ids)) {
    await open(m, id);
    const openState = await m.locator('[data-section]').evaluateAll((els) => els.map((e) => e.open));
    check(
      `5 ${kind}: phone accordion, only «معرفی» open`,
      JSON.stringify(openState) === JSON.stringify(SECTIONS(withVideo(id)).map((x) => x === 'intro')),
    );
    const order = await m.evaluate(
      (withVideo) =>
        [
          '[class*=gallery]',
          '[class*=info]',
          'aside[aria-label="خرید"]',
          '#intro',
          '#specs',
          withVideo ? '#video' : 'figure[data-media]',
          '#how',
          '#faq',
          '#reviews',
        ].map((q) => document.querySelector(q)?.getBoundingClientRect().top ?? -1),
      withVideo(id),
    );
    check(
      `5 ${kind}: phone order gallery, info, buy, intro, specs, video, how, FAQ, reviews`,
      order.every((t, i) => t >= 0 && (i === 0 || t > order[i - 1])),
      order.map(Math.round).join(','),
    );
    const bar = await m.locator('[class*=stickyBuy]').boundingBox();
    check(
      `5 ${kind}: sticky buy bar at the bottom`,
      !!bar && bar.y + bar.height <= 844 && bar.y > 600,
      bar ? `${Math.round(bar.y)}` : 'none',
    );
    heights.mobile[kind] = await m.evaluate(() => document.documentElement.scrollHeight);
    await shot(m, `layout-${kind}-390.png`, { fullPage: true });
  }
  await m.locator('[data-section="faq"] > summary').click();
  check(
    '5b tapping a section heading opens it',
    await m.locator('[data-section="faq"]').evaluate((e) => e.open),
  );
  // phone: the video is its own accordion section, and a #video link opens it
  await m.goto(`${BASE}/shop/product/${slug(ids.rich)}#video`, { waitUntil: 'load', timeout: 120000 });
  await m
    .waitForFunction(() => document.getElementById('video')?.open === true, null, { timeout: 15000 })
    .catch(() => {});
  await m.locator('#video button').click();
  const mv = await m.evaluate(() => ({
    title: document.querySelector('#video > summary h2')?.textContent,
    open: document.getElementById('video')?.open,
    player: document.querySelector('#video iframe')?.getBoundingClientRect().width ?? 0,
    over: document.documentElement.scrollWidth - innerWidth,
  }));
  check(
    '5c phone: «ویدیو معرفی محصول» accordion, opened by #video, player within the width',
    mv.title === 'ویدیو معرفی محصول' && mv.open && mv.player > 300 && mv.over <= 0,
    JSON.stringify(mv),
  );
  await shot(m, 'video-390.png');
  const mh = Object.values(heights.mobile);
  check(
    '4b phone heights in a close range (max ≤ 1.35 × min)',
    Math.max(...mh) <= 1.35 * Math.min(...mh),
    JSON.stringify(heights.mobile),
  );

  // ── widths ──
  for (const width of [390, 768, 1024, 1280, 1440, 1920]) {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    for (const id of Object.values(ids)) {
      await open(p, id);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(`6 ${width}px product ${id}: no horizontal scroll`, over <= 0, `overflow ${over}px`);
    }
    await p.close();
  }
} finally {
  await browser.close();
}
finish();
