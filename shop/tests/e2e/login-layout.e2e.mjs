// Sign-in page package F (local app; sends one dev SMS):
//  1. 375×667 (iPhone 8): the title, the phone field, «دریافت کد تأیید» and the terms are all on the first screen,
//     above the tab bar, without scrolling; the same for the code step
//  2. fields: phone type=tel, inputmode numeric, autocomplete tel; code inputmode numeric, autocomplete one-time-code
//  3. two columns only on desktop; no horizontal scroll at 320 … 1920
import { BASE, check, chromium, finish } from './_harness.mjs';

const stamp = String(Date.now()).slice(-6);
const browser = await chromium.launch();
/** bottom of the last visible control vs the top of the tab bar (phones) or the window */
const fits = (p) =>
  p.evaluate(() => {
    const card = document.querySelector('[data-auth-page] section');
    const last = [...card.querySelectorAll('button[type=submit], p')].at(-1).getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="ناوبری اصلی"]');
    const limit =
      nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
    return { bottom: Math.round(last.bottom), limit: Math.round(limit), scrollY: scrollY };
  });

try {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'x-real-ip': `10.87.1.${1 + (Date.now() % 200)}` },
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'load' });
  const f1 = await fits(p);
  check(
    '1a 375×667 phone step: everything above the tab bar, no scroll',
    f1.bottom <= f1.limit && f1.scrollY === 0,
    JSON.stringify(f1),
  );
  const phone = p.locator('[data-auth-page] input[name=phone]');
  check(
    '2a phone field: tel, numeric keyboard, autocomplete tel',
    (await phone.getAttribute('type')) === 'tel' &&
      (await phone.getAttribute('inputmode')) === 'numeric' &&
      (await phone.getAttribute('autocomplete')) === 'tel',
  );
  check('3a phones: one column (no side panel)', await p.locator('[data-auth-page] aside').isHidden());
  await phone.fill(`0913${stamp}1`);
  await p.getByRole('button', { name: 'دریافت کد تأیید' }).click();
  const code = p.locator('[data-auth-page] input[name=code]');
  await code.waitFor({ timeout: 20000 });
  check(
    '2b code field: numeric keyboard, one-time-code (SMS autofill)',
    (await code.getAttribute('inputmode')) === 'numeric' &&
      (await code.getAttribute('autocomplete')) === 'one-time-code',
  );
  await p.evaluate(() => scrollTo(0, 0));
  const f2 = await fits(p);
  check('1b 375×667 code step: «ورود» above the tab bar', f2.bottom <= f2.limit, JSON.stringify(f2));
  await ctx.close();

  for (const w of [320, 360, 390, 768, 1024, 1280, 1440, 1920]) {
    const q = await browser.newPage({
      viewport: { width: w, height: 800 },
      isMobile: w < 768,
      hasTouch: w < 768,
    });
    await q.goto(`${BASE}/login`, { waitUntil: 'load' });
    check(
      `3b ${w}px: no horizontal scroll`,
      await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    );
    if (w >= 1024) check(`3c ${w}px: two columns`, await q.locator('[data-auth-page] aside').isVisible());
    await q.close();
  }
} finally {
  await browser.close();
}
finish();
