// Viewport matrix: every main page at 320 … 1920 px (375×667 = iPhone 8) has no horizontal page scroll
// (document.scrollWidth ≤ innerWidth). A screenshot of each is kept in .artifacts/viewports/ (git-ignored) for review.
// Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, check, chromium, finish, shopRoot, sql } from './_harness.mjs';

const WIDTHS = [
  [320, 640],
  [360, 740],
  [375, 667],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
];
const out = path.join(shopRoot, '.artifacts', 'viewports');
fs.mkdirSync(out, { recursive: true });

// real addresses from the running shop: the first category and brand linked from the home page, a product, a pack
const home = await (await fetch(`${BASE}/`)).text();
const firstHref = (prefix) => new RegExp(`href="(${prefix}[^"#?]+)"`).exec(home)?.[1];
const productSlug = sql(
  `select slug_en from product_catalog where is_sellable and price > 0 and missing_since is null and slug_en is not null order by id limit 1`,
);
const PAGES = {
  home: '/',
  shop: '/shop',
  category: firstHref('/c/'),
  brand: firstHref('/brands/'),
  product: `/p/${productSlug}`,
  offers: '/offers',
  pack: '/packs/skin-routine/oily',
  login: '/login',
};
check(
  'test data: a category, a brand and a product address',
  Object.values(PAGES).every(Boolean),
  JSON.stringify(PAGES),
);

const browser = await chromium.launch();
try {
  for (const [w, h] of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      isMobile: w < 768,
      hasTouch: w < 768,
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    for (const [name, url] of Object.entries(PAGES)) {
      if (!url) continue;
      await page.goto(`${BASE}${url}`, { waitUntil: 'load', timeout: 120000 });
      const { sw, iw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
      }));
      await page.screenshot({ path: path.join(out, `${name}-${w}x${h}.png`) });
      check(`${name} ${w}×${h}: no horizontal page scroll`, sw <= iw, `${sw} vs ${iw}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`screenshots: ${out}`);
finish();
