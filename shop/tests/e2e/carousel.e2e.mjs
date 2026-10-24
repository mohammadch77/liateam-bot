// The shared Carousel (src/ui/carousel) on its styleguide sample (fixed data): previous / next buttons (hidden at the
// ends), ←/→ on the focused list, mouse drag that never ends as a click, all cards one size, and on a phone: no
// arrows, touch scrolling (CDP touch gesture) that moves the list but not the page, no card lift on touch.
// Read-only. Needs APP_ENV other than production (the styleguide page).
import { BASE, check, chromium, finish } from './_harness.mjs';

const URL = `${BASE}/styleguide#carousel`;
const browser = await chromium.launch();
try {
  // ── desktop ──
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'load' });
  const root = page.locator('#carousel [data-carousel]');
  const track = root.locator('ul');
  await track.scrollIntoViewIfNeeded();
  await root.locator('[data-carousel-next]').waitFor({ state: 'visible' });
  const pos = () => track.evaluate((el) => Math.round(el.scrollLeft));
  const settle = () =>
    track.evaluate(
      (el) =>
        new Promise((resolve) => {
          let last = el.scrollLeft;
          let same = 0;
          const tick = () => {
            same = el.scrollLeft === last ? same + 1 : 0;
            last = el.scrollLeft;
            if (same >= 5) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );

  check(
    '1a at the start: «previous» hidden, «next» shown',
    (await root.locator('[data-carousel-prev]').isHidden()) &&
      (await root.locator('[data-carousel-next]').isVisible()),
  );
  const p0 = await pos();
  await root.locator('[data-carousel-next]').click();
  await settle();
  const p1 = await pos();
  check('1b «next» scrolls towards the end (left in RTL)', p1 < p0, `${p0} → ${p1}`);
  await root.locator('[data-carousel-prev]').waitFor({ state: 'visible' });
  check('1c after moving: «previous» shown', await root.locator('[data-carousel-prev]').isVisible());
  check(
    '1d arrows have Persian names',
    (await root.locator('[data-carousel-prev]').getAttribute('aria-label')) === 'موارد قبلی' &&
      (await root.locator('[data-carousel-next]').getAttribute('aria-label')) === 'موارد بعدی',
  );

  // keyboard: ← on the focused list goes further towards the end in RTL, → back
  await track.focus();
  await page.keyboard.press('ArrowLeft');
  await settle();
  const p2 = await pos();
  await page.keyboard.press('ArrowRight');
  await settle();
  const p3 = await pos();
  check('2 keyboard: ← towards the end, → back (RTL)', p2 < p1 && p3 > p2, `${p1} → ${p2} → ${p3}`);

  // to the very end: «next» disappears
  for (let i = 0; i < 12 && (await root.locator('[data-carousel-next]').isVisible()); i++) {
    await root.locator('[data-carousel-next]').click();
    await settle();
  }
  check('1e at the end: «next» hidden', await root.locator('[data-carousel-next]').isHidden());

  // mouse drag back to the start; the click that ends it opens nothing
  const urlBefore = page.url();
  const box = await track.boundingBox();
  const y = box.y + box.height * 0.6;
  const before = await pos();
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * 0.7 - i * 40, y); // hand to the left: back towards the start (RTL)
  await page.mouse.up();
  await settle();
  const after = await pos();
  check(
    '3a mouse drag moves the list (content follows the hand)',
    after > before + 200,
    `${before} → ${after}`,
  );
  check('3b a drag does not open the card under the pointer', page.url() === urlBefore, page.url());
  check(
    '3c no text selected after the drag',
    (await page.evaluate(() => String(window.getSelection()))).trim() === '',
  );

  // all cards one size
  const sizes = await track.locator(':scope > li').evaluateAll((lis) =>
    lis.map((li) => {
      const r = li.getBoundingClientRect();
      return `${Math.round(r.width)}×${Math.round(r.height)}`;
    }),
  );
  check('4 every card the same width and height', new Set(sizes).size === 1, [...new Set(sizes)].join(' '));
  await page.close();

  // ── phone ──
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });
  const m = await ctx.newPage();
  await m.goto(URL, { waitUntil: 'load' });
  const mt = m.locator('#carousel [data-carousel] ul');
  await mt.scrollIntoViewIfNeeded();
  check('5a phone: no arrow buttons', await m.locator('#carousel [data-carousel-next]').isHidden());
  const mb = await mt.boundingBox();
  const sy = await m.evaluate(() => window.scrollY);
  const ms0 = await mt.evaluate((el) => el.scrollLeft);
  const cdp = await ctx.newCDPSession(m);
  // a real touch sequence: finger down, moved 250px to the right (towards the end of an RTL list), lifted
  const ty = Math.round(mb.y + mb.height * 0.5);
  const tx = Math.round(mb.x + mb.width * 0.2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: tx + i * 25, y: ty }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mt.evaluate(
    (el) =>
      new Promise((r) => {
        let last = -1;
        const t = () => (el.scrollLeft === last ? r() : ((last = el.scrollLeft), setTimeout(t, 120)));
        t();
      }),
  );
  const ms1 = await mt.evaluate((el) => el.scrollLeft);
  const sy1 = await m.evaluate(() => window.scrollY);
  check('5b touch swipe scrolls the list', ms1 !== ms0, `${ms0} → ${ms1}`);
  check('5c the page itself does not move vertically', Math.abs(sy1 - sy) < 2, `${sy} → ${sy1}`);
  const lift = await m.evaluate(() => {
    const card = document.querySelector('#carousel [data-carousel] li article');
    card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
    return { hover: matchMedia('(hover: hover)').matches, transform: getComputedStyle(card).transform };
  });
  check(
    '5d touch: no hover lift on cards',
    !lift.hover && (lift.transform === 'none' || lift.transform === ''),
    JSON.stringify(lift),
  );
  const sw = await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('5e no horizontal page scroll', sw);
  await ctx.close();
} finally {
  await browser.close();
}
finish();
