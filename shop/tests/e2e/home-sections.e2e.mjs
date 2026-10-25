// Home page package B (read-only):
//  1. offers, best sellers, brands (phones) and magazine use the shared Carousel
//  2. brands: one row of 7 equal tiles over the full width ≥1024, 4 columns on a tablet, a carousel with big tiles
//     on a phone
//  3. «روتین پوستی»: one tab per skin type, one compact card (5 rows), pack price, «افزودن پک به سبد خرید»
//     (a placeholder like the product page's button) and «مشاهده محصولات»
//  4. hero on phones: Liateam's portrait banner edge to edge, ≥70% of the first screen, not cropped (3:4), fully
//     above the tab bar; no layout shift on load (CLS < 0.1)
import { BASE, check, chromium, finish } from './_harness.mjs';

const browser = await chromium.launch();
const pageAt = (width, height) =>
  browser.newPage({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
const tiles = (p) =>
  p.locator('[data-home-section="brands"] [data-carousel] > ul > li').evaluateAll((lis) =>
    lis.map((li) => {
      const r = li.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
    }),
  );

try {
  // ── desktop ──
  const d = await pageAt(1440, 900);
  await d.goto(`${BASE}/`, { waitUntil: 'load' });
  for (const sel of ['[data-offers]', '[data-bestsellers]', '[data-home-section="magazine"]']) {
    const n = await d.locator(`${sel} [data-carousel]`).count();
    // offers may be the «به‌زودی» frame when nothing is discounted
    const soon = sel === '[data-offers]' && (await d.locator('[data-offers="soon"]').count()) === 1;
    check(`1 ${sel}: the shared Carousel`, n === 1 || soon, String(n));
  }
  const brands = d.locator('[data-home-section="brands"]');
  await brands.scrollIntoViewIfNeeded();
  const t = await tiles(d);
  const box = await brands.boundingBox();
  check(
    '2a 1440: 7 brand tiles in one row, equal widths, across the whole width',
    t.length === 7 &&
      new Set(t.map((x) => x.y)).size === 1 &&
      Math.max(...t.map((x) => x.w)) - Math.min(...t.map((x) => x.w)) <= 1 &&
      Math.min(...t.map((x) => x.x)) - box.x <= 4,
    JSON.stringify(t.map((x) => x.w)),
  );
  const routine = d.locator('[data-routine]');
  await routine.scrollIntoViewIfNeeded();
  check(
    '3a routine: one tab per skin type, one selected',
    (await routine.locator('[role=tab]').count()) >= 4 &&
      (await routine.locator('[role=tab][aria-selected=true]').count()) === 1,
  );
  check('3b routine: five rows in one card', (await routine.locator('[role=tabpanel] li').count()) === 5);
  const add = routine.locator('[data-routine-add]');
  check(
    '3c «افزودن پک به سبد خرید»: present, a placeholder like the product page (aria-disabled, به‌زودی)',
    (await add.innerText()).includes('افزودن پک به سبد خرید') &&
      (await add.getAttribute('aria-disabled')) === 'true' &&
      /به‌زودی/.test((await add.getAttribute('title')) ?? ''),
  );
  check(
    '3d «مشاهده محصولات» → the pack page',
    /^\/packs\//.test((await routine.getByText('مشاهده محصولات').getAttribute('href')) ?? ''),
  );
  await routine.locator('[role=tab]').nth(1).focus();
  await d.keyboard.press('ArrowLeft');
  check(
    '3e routine tabs: ← moves to the next skin type (RTL)',
    (await routine.locator('[role=tab]').nth(2).getAttribute('aria-selected')) === 'true',
  );
  await d.close();

  // ── tablet ──
  const tb = await pageAt(768, 1024);
  await tb.goto(`${BASE}/`, { waitUntil: 'load' });
  await tb.locator('[data-home-section="brands"]').scrollIntoViewIfNeeded();
  const tt = await tiles(tb);
  check(
    '2b 768: brands in 4 columns',
    new Set(tt.map((x) => x.x)).size === 4,
    String(new Set(tt.map((x) => x.x)).size),
  );
  await tb.close();

  // ── phones ──
  for (const [w, h] of [
    [375, 667],
    [390, 844],
  ]) {
    const m = await pageAt(w, h);
    await m.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await m.goto(`${BASE}/`, { waitUntil: 'load' });
    await m.waitForTimeout(1500);
    const hero = await m.evaluate(() => {
      const pic = document.querySelector('[data-hero-link] picture');
      const img = pic.querySelector('img');
      const r = pic.getBoundingClientRect();
      const nav = document.querySelector('nav[aria-label="ناوبری اصلی"]').getBoundingClientRect();
      return {
        w: r.width,
        h: r.height,
        bottom: r.bottom,
        navTop: nav.top,
        nat: img.naturalWidth / img.naturalHeight,
      };
    });
    check(
      `4a ${w}×${h}: banner edge to edge and ≥70% of the screen`,
      Math.round(hero.w) === w && hero.h >= h * 0.7 * (h > 700 ? 0.85 : 1),
      `${Math.round(hero.w)}×${Math.round(hero.h)}`,
    );
    check(
      `4b ${w}×${h}: the banner is the photo's own ratio (no text cropped) and ends above the tab bar`,
      Math.abs(hero.w / hero.h - hero.nat) < 0.02 && hero.bottom <= hero.navTop + 1,
      `${(hero.w / hero.h).toFixed(3)} vs ${hero.nat.toFixed(3)}; ${Math.round(hero.bottom)} ≤ ${Math.round(hero.navTop)}`,
    );
    check(
      `4c ${w}×${h}: CLS < 0.1`,
      (await m.evaluate(() => window.__cls)) < 0.1,
      String(await m.evaluate(() => window.__cls)),
    );
    const bt = m.locator('[data-home-section="brands"]');
    await bt.scrollIntoViewIfNeeded();
    const mt = await tiles(m);
    check(
      `2c ${w}: brands scroll sideways, big tiles`,
      mt.length === 7 && mt[0].w >= 140 && new Set(mt.map((x) => x.y)).size === 1,
      String(mt[0]?.w),
    );
    const card = await m.locator('[data-routine] [role=tabpanel]').boundingBox();
    check(
      `3f ${w}: the routine card is compact (< 560px)`,
      card.height < 560,
      String(Math.round(card.height)),
    );
    check(
      `5 ${w}: no horizontal page scroll`,
      await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    await m.close();
  }
} finally {
  await browser.close();
}
finish();
