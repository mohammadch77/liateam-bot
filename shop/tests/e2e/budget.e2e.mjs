// Performance budget (light, no Lighthouse): a phone loads the home page, a product page and a listing; per page the
// JavaScript and the total bytes received stay under the budget, no product / menu data is fetched on load (only on
// interaction), the layout shift stays under 0.1, and the page has at most so many elements. Read-only.
import { BASE, check, chromium, finish, sql } from './_harness.mjs';

const BUDGET = {
  jsKb: 190, // compressed JavaScript per page (React + Next ≈ 150 KB of it)
  totalKb: 1100, // everything received by `load` (pictures included)
  cls: 0.1,
  elements: 1400, // Lighthouse's «excessive DOM size» line (product 426 with 53 FAQs and 20 reviews: ~1100)
};
const slug = sql(`select slug_en from product_catalog where id = 426`);
const pages = ['/', `/p/${slug}`, '/shop'];

const browser = await chromium.launch();
try {
  for (const path of pages) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    let js = 0;
    let total = 0;
    const lazyCalls = [];
    page.on('requestfinished', async (req) => {
      const sizes = await req.sizes().catch(() => null);
      const bytes = sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0;
      total += bytes;
      if (req.resourceType() === 'script') js += bytes;
      if (/\/api\/(nav\/products|bestsellers)/.test(req.url())) lazyCalls.push(req.url());
    });
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForTimeout(2500); // late shifts (images, fonts, client code)
    const [cls, elements] = await page.evaluate(() => [window.__cls, document.querySelectorAll('*').length]);
    const name = path.length > 30 ? `${path.slice(0, 27)}…` : path;
    check(`${name}: JavaScript ≤ ${BUDGET.jsKb} KB`, js / 1024 <= BUDGET.jsKb, `${Math.round(js / 1024)} KB`);
    check(
      `${name}: received by load ≤ ${BUDGET.totalKb} KB`,
      total / 1024 <= BUDGET.totalKb,
      `${Math.round(total / 1024)} KB`,
    );
    check(`${name}: no product / menu data fetched on load`, lazyCalls.length === 0, lazyCalls.join(' '));
    check(`${name}: layout shift < ${BUDGET.cls}`, cls < BUDGET.cls, cls.toFixed(3));
    check(`${name}: ≤ ${BUDGET.elements} elements`, elements <= BUDGET.elements, `${elements}`);
    await page.close();
  }
} finally {
  await browser.close();
}
finish();
