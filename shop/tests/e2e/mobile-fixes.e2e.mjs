// Phone fixes with real touch (WebKit iPhone 8 / iPhone 13) and the width matrix (Chromium). Read-only.
//  3. search: tapping a suggestion opens that product (/<slug>), Enter → /search?q=…; the field is ≥16px; a single
//     magnifier (the native one is off)
//  2. hero: edge to edge (its width = the viewport) at 320 … 767 and not full-bleed from 768
//  4. «افزودن پک به سبد خرید» stays inside the routine card at 320 … 820
//  6. brand tiles carry up to three product photos below 1024px and keep one size
import { BASE, check, chromium, devices, finish, webkit } from './_harness.mjs';

const wk = await webkit.launch();
for (const name of ['iPhone 8', 'iPhone 13']) {
  const ctx = await wk.newContext({ ...devices[name] });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.locator('nav[aria-label="ناوبری اصلی"] [data-open-search]').tap();
  const input = p.locator('[data-search-overlay] input[role=combobox]');
  await input.waitFor({ state: 'visible' });
  const fs = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(`3a ${name}: the search field is ≥ 16px (no iOS zoom)`, fs >= 16, `${fs}px`);
  const deco = await input.evaluate(
    (el) => getComputedStyle(el).appearance || getComputedStyle(el).webkitAppearance,
  );
  check(`3b ${name}: no native search look (appearance none) — only our magnifier`, deco === 'none', deco);
  await input.fill('ریمل');
  const first = p.locator('[data-search-overlay] [role=option]').nth(1);
  await first.waitFor({ timeout: 20000 });
  await first.tap();
  await p
    .waitForFunction(
      () => /^\/[a-z0-9-]+-\d+$/.test(location.pathname) || /^\/\d+/.test(location.pathname),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  check(
    `3c ${name}: tapping a suggestion opens the product page`,
    /^\/shop\/product\/[a-z0-9-]+-\d+$/.test(new URL(p.url()).pathname),
    p.url(),
  );
  check(
    `3d ${name}: the search dialog closed after navigating`,
    await p.locator('[data-search-overlay]').isHidden(),
  );
  // Enter → the results page
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.locator('nav[aria-label="ناوبری اصلی"] [data-open-search]').tap();
  await p.locator('[data-search-overlay] input[role=combobox]').fill('سرم');
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/shop\/search\?q=/, { timeout: 30000 });
  check(`3e ${name}: Enter → /search?q=…`, decodeURIComponent(p.url()).includes('/shop/search?q=سرم'), p.url());
  await ctx.close();
}
await wk.close();

const cr = await chromium.launch();
for (const w of [320, 360, 375, 390, 412, 414, 640, 700, 767, 768, 820]) {
  const ctx = await cr.newContext({
    viewport: { width: w, height: 800 },
    isMobile: w < 768,
    hasTouch: w < 768,
  });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  const hero = await p.evaluate(() => {
    const r = document.querySelector('[data-hero-link] picture').getBoundingClientRect();
    return {
      l: Math.round(r.left),
      w: Math.round(r.width),
      over: document.documentElement.scrollWidth - innerWidth,
    };
  });
  if (w < 768)
    check(
      `2 ${w}: hero edge to edge (width = viewport), no horizontal scroll`,
      hero.l === 0 && hero.w === w && hero.over <= 0,
      JSON.stringify(hero),
    );
  else
    check(`2 ${w}: from 768 the hero stays inside the gutter (unchanged)`, hero.l > 0, JSON.stringify(hero));
  if (w < 768) check(`2c ${w}: CLS < 0.1`, (await p.evaluate(() => window.__cls)) < 0.1);

  // 4 the pack buttons stay inside the card (below 1024)
  const routine = p.locator('[data-routine]').first();
  await routine.scrollIntoViewIfNeeded();
  const inside = await p.evaluate(() => {
    const card = document.querySelector('[data-routine] [role=tabpanel]').getBoundingClientRect();
    const btn = [...document.querySelectorAll('[data-routine-add], [data-routine] a[class*=view]')].map((b) =>
      b.getBoundingClientRect(),
    );
    return { ok: btn.every((r) => r.right <= card.right + 0.5 && r.left >= card.left - 0.5), n: btn.length };
  });
  if (w < 1024)
    check(
      `4 ${w}: «افزودن پک به سبد خرید» and «مشاهده محصولات» stay inside the card`,
      inside.ok && inside.n === 2,
      JSON.stringify(inside),
    );

  // 6 brand tiles
  if (w < 1024) {
    await p.locator('[data-home-section="brands"]').scrollIntoViewIfNeeded();
    const tiles = await p.locator('[data-home-section="brands"] [data-brand]').evaluateAll((els) =>
      els.map((e) => ({
        thumbs: e.querySelectorAll('img').length,
        h: Math.round(e.getBoundingClientRect().height),
      })),
    );
    check(
      `6 ${w}: brand tiles show product photos and keep one height`,
      tiles.length > 0 &&
        tiles.filter((t) => t.thumbs >= 2).length >= tiles.length - 1 &&
        new Set(tiles.map((t) => t.h)).size === 1,
      JSON.stringify(tiles.slice(0, 3)),
    );
  }
  await ctx.close();
}
await cr.close();
finish();
