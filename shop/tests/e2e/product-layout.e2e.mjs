// Product page template end to end on three sample products — rich (426: video, 53 FAQs, long text), medium
// (160) and low-data (520: no FAQ, no summary): the same five tabs and sections for all, empty states instead of
// missing sections, long text / FAQ / reviews / specs folded, page heights in a close range, the phone accordion
// («معرفی» open) and sticky buy bar, no horizontal scroll at 390–1920 px. Read-only.
import { BASE, check, chromium, finish, shot, sql } from './_harness.mjs';

const ids = { rich: 426, medium: 160, low: 520 };
const slug = (id) => sql(`select slug_en from product_catalog where id = ${id}`);
const TABS = ['معرفی', 'مشخصات', 'نحوه مصرف', 'پرسش‌ها', 'دیدگاه‌ها'];
const SECTIONS = ['intro', 'specs', 'how', 'faq', 'reviews'];

const browser = await chromium.launch();
const open = async (page, id) => {
  await page.goto(`${BASE}/p/${slug(id)}`, { waitUntil: 'load', timeout: 120000 });
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
      JSON.stringify(tabs) === JSON.stringify(TABS),
      tabs.join(' | '),
    );
    const sections = await d
      .locator('[data-section]')
      .evaluateAll((els) => els.map((e) => e.dataset.section));
    check(
      `1 ${kind}: the same five sections in the same order`,
      JSON.stringify(sections) === JSON.stringify(SECTIONS),
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
    const quick = await d.locator('dl[aria-label="مشخصات سریع"] dt').allInnerTexts();
    check(
      `1 ${kind}: quick specs card (brand, size, country)`,
      JSON.stringify(quick) === JSON.stringify(['برند', 'حجم', 'کشور سازنده']),
    );
    check(
      `1 ${kind}: rating line (٪ · دیدگاه · پرسش)`,
      /٪ پیشنهاد/.test(await d.locator('main p a[href="#reviews"]').first().innerText()) &&
        (await d.locator('main p a[href="#faq"]').count()) === 1,
    );
    heights.desktop[kind] = await d.evaluate(() => document.documentElement.scrollHeight);
    if (kind === 'rich') {
      check(
        '2a rich: long description folded with «ادامه‌ی مطلب»',
        (await d.getByText('ادامه‌ی مطلب').count()) === 1,
      );
      const faqShown = await d.locator('#faq details:not([class*=more] details):visible').count();
      check(
        '2b rich: 5 FAQs + «نمایش همه‌ی ۵۳ پرسش»',
        (await d.getByText(/نمایش همه‌ی ۵۳ پرسش/).count()) === 1,
        `${faqShown} visible`,
      );
      check(
        '2c rich: video beside the introduction',
        (await d.locator('#intro iframe[src^="https://player.arvancloud.ir/"]').count()) === 1,
      );
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
      await d.getByText('ادامه‌ی مطلب').click();
      const unfolded = await d
        .locator('[class*=fold] > [class*=foldBody]')
        .first()
        .evaluate((e) => e.scrollHeight <= e.clientHeight + 2);
      check('2f «ادامه‌ی مطلب» unfolds the whole text', unfolded);
    }
    if (kind === 'low') {
      check(
        '3a low: FAQ empty state + contact link',
        (await d.locator('#faq a[href="/contact"]').count()) === 1 &&
          (await d.getByText('پرسشی برای این محصول ثبت نشده است').count()) === 1,
      );
      check(
        '3b low: photo beside the introduction (no video)',
        (await d.locator('#intro figure img').count()) === 1,
      );
    }
    check(
      `3 ${kind}: our general care note under «نحوه مصرف»`,
      (await d.locator('#how [role=note]').count()) === 1,
    );
    await d.evaluate(() => window.scrollTo(0, 0));
    await shot(d, `layout-${kind}-1440.png`, { fullPage: true });
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
      JSON.stringify(openState) === JSON.stringify([true, false, false, false, false]),
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
      check(`6 ${width}px /p/${id}: no horizontal scroll`, over <= 0, `overflow ${over}px`);
    }
    await p.close();
  }
} finally {
  await browser.close();
}
finish();
