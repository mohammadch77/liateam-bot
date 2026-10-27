// Product page package D (read-only):
//  1. «محصولات مرتبط»: exactly 4 when there are enough (never the product itself, never twice, never out of stock);
//     desktop a 4-column grid, phones and tablets the shared Carousel with equal cards
//  2. below 1024px the buy box under the specs shows no second price / «افزودن به سبد» (the sticky bar has them);
//     from 1024px the buy box keeps them; the sticky bar stays on phones
import { BASE, check, chromium, finish, sql } from './_harness.mjs';

const slug = sql(
  `select slug_en from product_catalog
    where is_sellable and price > 0 and missing_since is null and stock > 0 and slug_en is not null
    order by id limit 1`,
);
const id = Number(/-(\d+)$/.exec(slug)?.[1]);
const browser = await chromium.launch();
const related = (p) =>
  p.locator('#related [data-carousel] > ul > li').evaluateAll((lis) =>
    lis.map((li) => {
      const r = li.getBoundingClientRect();
      const a = li.querySelector('a[href]');
      return {
        href: a?.getAttribute('href') ?? '',
        out: !!li.querySelector('[class*=outLabel]'),
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }),
  );

try {
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(`${BASE}/shop/product/${slug}`, { waitUntil: 'load' });
  await d.locator('#related').scrollIntoViewIfNeeded();
  const rd = await related(d);
  check('1a exactly 4 related products', rd.length === 4, String(rd.length));
  check(
    '1b not the product itself, no duplicates, none out of stock',
    new Set(rd.map((r) => r.href)).size === rd.length &&
      rd.every((r) => !r.href.endsWith(`-${id}`) && !r.out),
    rd.map((r) => r.href).join(' '),
  );
  check(
    '1c desktop: one row of 4 equal columns',
    new Set(rd.map((r) => r.y)).size === 1 && new Set(rd.map((r) => r.w)).size === 1,
    JSON.stringify(rd.map((r) => [r.w, r.y])),
  );
  check(
    '2a desktop: the buy box shows price and «افزودن به سبد»',
    await d.locator('aside[aria-label="خرید"]').getByRole('button', { name: 'افزودن به سبد' }).isVisible(),
  );
  await d.close();

  for (const [w, h] of [
    [375, 667],
    [768, 1024],
  ]) {
    const m = await browser.newPage({
      viewport: { width: w, height: h },
      isMobile: w < 768,
      hasTouch: w < 768,
    });
    await m.goto(`${BASE}/shop/product/${slug}`, { waitUntil: 'load' });
    await m.locator('#related').scrollIntoViewIfNeeded();
    const rm = await related(m);
    check(
      `1d ${w}: related in the Carousel, cards one size`,
      rm.length === 4 &&
        new Set(rm.map((r) => r.y)).size === 1 &&
        new Set(rm.map((r) => `${r.w}×${r.h}`)).size === 1,
      JSON.stringify(rm.map((r) => `${r.w}×${r.h}`)),
    );
    // clipped for the eye, kept for screen readers: the block itself is 1px (its contents keep their own size)
    const block = await m.locator('aside[aria-label="خرید"] [class*=buyMain]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), clip: getComputedStyle(el).clipPath };
    });
    check(
      `2b ${w}: no second price / button under the specs (visually hidden, still read out)`,
      block.w <= 1 && block.h <= 1 && block.clip !== 'none',
      JSON.stringify(block),
    );
    check(
      `2c ${w}: the sticky bar still has price and button`,
      await m.locator('[class*=stickyBuy] button', { hasText: 'افزودن به سبد' }).isVisible(),
    );
    check(
      `3 ${w}: no horizontal page scroll`,
      await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    await m.close();
  }
} finally {
  await browser.close();
}
finish();
