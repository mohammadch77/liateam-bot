// Header package C (local app; one sign-in):
//  1. parity: every action of the desktop header (account / sign-in, wallet, cart) is reachable on phones 320–390 —
//     in the header, the tab bar or the menu — with touch targets ≥ 44px, and the header row never overflows
//  2. the phone menu: full height, two levels (a category opens its sub-categories, «همه‌ی محصولات …» first,
//     «بازگشت»), brands as their own level, a fixed footer (account, wallet, order tracking), Esc and a swipe close
//     it, the page behind does not scroll
//  3. the support number (SUPPORT_PHONE) after «پیگیری سفارش» with a tel: link, when it is set
import { BASE, check, chromium, finish, signIn } from './_harness.mjs';

const stamp = String(Date.now()).slice(-6);
const browser = await chromium.launch();
const phone = (w, ctxOpts = {}) =>
  browser.newContext({ viewport: { width: w, height: 700 }, isMobile: true, hasTouch: true, ...ctxOpts });

/** visible, ≥44px targets of the phone header and tab bar, by action */
const phoneActions = (p) =>
  p.evaluate(() => {
    const out = {};
    const add = (k, el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out[k] = Math.min(Math.round(r.width), Math.round(r.height));
    };
    for (const el of document.querySelectorAll('header [class*=mobile] [data-header-action]'))
      add(el.dataset.headerAction, el);
    for (const el of document.querySelectorAll('nav[aria-label="ناوبری اصلی"] a')) {
      const h = el.getAttribute('href');
      if (h === '/cart') add('cart', el);
      if (h === '/account' || h === '/login') add('account', el);
    }
    return out;
  });

try {
  // ── desktop actions ──
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(`${BASE}/`, { waitUntil: 'load' });
  const desktopOut = await d
    .locator('header [class*=desktop] [data-header-action]')
    .evaluateAll((els) => els.map((e) => e.dataset.headerAction));

  // ── 1. signed out, phones ──
  for (const w of [320, 360, 375, 390]) {
    const ctx = await phone(w);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
    const a = await phoneActions(p);
    check(
      `1a ${w}px signed out: desktop actions (${desktopOut.join(', ')}) reachable, targets ≥ 44px`,
      desktopOut.every((k) => (a[k] ?? 0) >= 44),
      JSON.stringify(a),
    );
    const row = await p.evaluate(() => {
      const r = document.querySelector('header [class*=mobileRow]');
      return r.scrollWidth - r.clientWidth;
    });
    check(`1b ${w}px: the header row does not overflow`, row <= 0, `${row}px`);
    await ctx.close();
  }

  // signed in: the wallet joins on desktop and on phones
  const sctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'x-real-ip': `10.88.1.${1 + (Date.now() % 200)}` },
  });
  const sp = await sctx.newPage();
  await signIn(sp, `0914${stamp}1`);
  await sp.goto(`${BASE}/`, { waitUntil: 'load' });
  const desktopIn = await sp
    .locator('header [class*=desktop] [data-header-action]')
    .evaluateAll((els) => els.map((e) => e.dataset.headerAction));
  check(
    '1c desktop signed in: wallet, account, cart',
    ['wallet', 'account', 'cart'].every((k) => desktopIn.includes(k)),
    desktopIn.join(', '),
  );
  const cookies = await sctx.cookies();
  for (const w of [320, 360, 390]) {
    const ctx = await phone(w);
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
    const a = await phoneActions(p);
    check(
      `1d ${w}px signed in: wallet, account and cart reachable, targets ≥ 44px`,
      desktopIn.every((k) => (a[k] ?? 0) >= 44),
      JSON.stringify(a),
    );
    const row = await p.evaluate(() => {
      const r = document.querySelector('header [class*=mobileRow]');
      return r.scrollWidth - r.clientWidth;
    });
    check(`1e ${w}px signed in: the header row does not overflow`, row <= 0, `${row}px`);
    await ctx.close();
  }
  await sctx.close();

  // ── 2. the phone menu ──
  const mctx = await phone(375, { viewport: { width: 375, height: 667 } });
  const m = await mctx.newPage();
  await m.goto(`${BASE}/shop`, { waitUntil: 'load' });
  check(
    '2a the drawer content is not in the page before it opens',
    (await m.locator('[data-mobile-menu] nav').count()) === 0,
  );
  await m.getByRole('button', { name: 'منو' }).click();
  const drawer = m.locator('[data-mobile-menu]');
  await drawer.waitFor({ state: 'visible' });
  const box = await drawer.boundingBox();
  check('2b full height', Math.round(box.height) === 667, String(Math.round(box.height)));
  const locked = await m
    .waitForFunction(() => document.documentElement.classList.contains('drawer-open'), null, { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  check('2c the page behind is locked', locked);
  const footer = await drawer.locator('[class*=footer]').innerText();
  check(
    '2d fixed footer: sign-in, wallet, order tracking',
    /ورود/.test(footer) && /کیف پول/.test(footer) && /پیگیری سفارش/.test(footer),
    footer.replace(/\s+/g, ' '),
  );
  const cat = drawer.locator('[data-menu-category]').first();
  const catName = (await cat.innerText()).trim();
  await cat.click();
  await m.waitForFunction(
    () => document.querySelector('[data-mobile-menu]')?.dataset.mobileMenu === 'category',
  );
  check(
    '2e a category opens its own level: «همه‌ی محصولات …» first, then sub-categories, focus on «بازگشت»',
    (await drawer.locator('[class*=allProducts]').first().innerText()).includes(`همه‌ی محصولات ${catName}`) &&
      (await drawer.locator('[class*=list] a').count()) > 0 &&
      (await m.evaluate(() => document.activeElement?.hasAttribute('data-menu-back'))),
    catName,
  );
  await drawer.locator('[data-menu-back]').click();
  check('2f «بازگشت» → the first level', (await drawer.getAttribute('data-mobile-menu')) === 'root');
  await drawer.locator('[data-menu-brands]').click();
  check(
    '2g brands are their own level',
    (await drawer.getAttribute('data-mobile-menu')) === 'brands' &&
      (await drawer.locator('[class*=list] a').count()) >= 5,
  );
  await m.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  check(
    '2h Esc closes it and unlocks the page',
    !(await m.evaluate(() => document.documentElement.classList.contains('drawer-open'))),
  );
  await m.getByRole('button', { name: 'منو' }).click();
  await drawer.waitFor({ state: 'visible' });
  check('2i reopens at the first level', (await drawer.getAttribute('data-mobile-menu')) === 'root');
  const cdp = await mctx.newCDPSession(m);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 300 }] });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 120 + i * 20, y: 302 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  check('2j a swipe towards the edge closes it', await drawer.isHidden());
  await mctx.close();

  // ── 3. support number ──
  const html = await (await fetch(`${BASE}/`)).text();
  const tel = /<a href="tel:([+\d]+)"[^>]*>/.exec(html);
  if (tel) {
    const top = html.slice(html.indexOf('پیگیری سفارش'));
    check('3 support number after «پیگیری سفارش», tel: link', top.indexOf(`tel:${tel[1]}`) > 0, tel[1]);
  } else {
    check('3 no SUPPORT_PHONE set: no call link at all', !/href="tel:/.test(html));
  }
  await d.close();
} finally {
  await browser.close();
}
finish();
