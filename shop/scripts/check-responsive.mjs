// Responsive gate (contract clause 10-1): every page at phone, tablet and desktop widths must have
// no horizontal page scroll and no content clipped out of cards/panels. Run against a running app:
//   npm run check:responsive                       (http://127.0.0.1:3850, pages below)
//   npm run check:responsive -- http://host:port /path1 /path2
// Exit code 1 on any failure, so it can gate a phase delivery.
import { createRequire } from 'node:module';

// Playwright is installed once at the repo root (the sync bot uses it).
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');

// Add every new page here as it is built.
const PAGES = ['/', '/login', '/styleguide'];
const WIDTHS = [
  [360, 780],
  [390, 844],
  [768, 1024],
  [1024, 800],
  [1440, 900],
  [1920, 1080],
];

const [base = 'http://127.0.0.1:3850', ...custom] = process.argv.slice(2);
const pages = custom.length ? custom : PAGES;
const browser = await chromium.launch();
let failures = 0;

for (const path of pages) {
  for (const [w, h] of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    const res = await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const scrollable = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0].slice(0, 40)}`;
      const outside = [...document.querySelectorAll('body *')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && !scrollable(el) && (b.right > vw + 1 || b.left < -1);
        })
        .slice(0, 3)
        .map(name);
      // Content cut off inside a card (overflow:hidden would hide it from the page check).
      // Text that deliberately ends in an ellipsis is not a defect.
      const clipped = [...document.querySelectorAll('article')]
        .flatMap((box) => {
          const r = box.getBoundingClientRect();
          return [...box.querySelectorAll('button, a, b, span')].filter((el) => {
            const b = el.getBoundingClientRect();
            const s = getComputedStyle(el.parentElement ?? el);
            return (
              b.width > 1 && s.textOverflow !== 'ellipsis' && (b.right > r.right + 1 || b.left < r.left - 1)
            );
          });
        })
        .slice(0, 3)
        .map(name);
      return { overflowX: document.documentElement.scrollWidth - vw, outside, clipped };
    });
    const bad = !res?.ok() || r.overflowX > 0 || r.outside.length || r.clipped.length || jsErrors.length;
    if (bad) failures++;
    console.log(
      `${bad ? '✗' : '✓'} ${path.padEnd(14)} ${String(w).padStart(4)}px`,
      bad ? JSON.stringify({ status: res?.status(), ...r, jsErrors: jsErrors.slice(0, 2) }) : '',
    );
    await page.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : '\nall pages responsive at every width');
process.exit(failures ? 1 : 0);
