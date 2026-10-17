// Mega menu (desktop) and category drawer (mobile) end to end: Liateam's order from the database, hover /
// click / outside click / Esc, keyboard Tab order, links, accordion, no horizontal scroll at 390–1920 px.
import { BASE, check, chromium, finish, requireLocalApp, shot, sql } from './_harness.mjs';

requireLocalApp();
// Expected top-level order: Liateam's (categories.position), only categories with a visible product in their subtree.
const LIATEAM = sql(`
  WITH RECURSIVE t(root, code) AS (
    SELECT code, code FROM categories WHERE parent_code IS NULL AND in_source
    UNION SELECT t.root, c.code FROM t JOIN categories c ON c.parent_code = t.code)
  SELECT btrim(regexp_replace(r.name, '[[:space:]]+', ' ', 'g')) FROM categories r
   WHERE r.code IN (SELECT t.root FROM t JOIN product_catalog p ON t.code = ANY (p.category)
                     WHERE p.is_sellable AND p.price > 0 AND p.missing_since IS NULL)
   ORDER BY r.position`).split(/\r?\n/);
const b = await chromium.launch();

// ── desktop ──
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(BASE + '/', { waitUntil: 'load' });
const trigger = p.getByRole('button', { name: 'دسته‌بندی کالاها' });
const panel = p.locator(`#${await trigger.getAttribute('aria-controls')}`.replace(/:/g, '\\:'));
const mainTop = () => p.locator('main').evaluate((m) => m.getBoundingClientRect().top);
const top0 = await mainTop();
check(
  'closed at load',
  (await trigger.getAttribute('aria-expanded')) === 'false' && !(await panel.isVisible()),
);
await trigger.hover();
await p.waitForTimeout(150);
check('hover opens', await panel.isVisible());
check('no layout shift on open', (await mainTop()) === top0, `main top ${top0} → ${await mainTop()}`);
const roots = await panel.locator('ul[aria-label="دسته‌بندی‌های اصلی"] > li > a').allInnerTexts();
check(
  'top-level order = Liateam menu',
  JSON.stringify(roots.map((t) => t.trim())) === JSON.stringify(LIATEAM),
  roots.join(' | '),
);
check('hidden categories absent', !roots.some((t) => /ابزار/.test(t)));
await panel.getByRole('link', { name: 'آرایشی', exact: true }).hover();
await p.waitForTimeout(250);
const subs = await panel.locator('ul[aria-label="زیردسته‌های آرایشی"] a').allInnerTexts();
check(
  'hover a category shows its children in order',
  /^ریمل/.test(subs[0] ?? '') && subs.length === 7,
  subs.map((t) => t.split('\n')[0]).join(' | '),
);
await p
  .waitForFunction(
    () => [...document.querySelectorAll('[class*=promo] img')].every((i) => i.complete && i.naturalWidth),
    null,
    { timeout: 40000 },
  )
  .catch(() => {});
await shot(p, 'mega-desktop.png');
await p.mouse.move(700, 880); // leave the header
await p.waitForTimeout(400);
check('hover-out closes (when opened by hover)', !(await panel.isVisible()));

// click + outside click
await p.mouse.move(700, 600);
await trigger.click();
await p.mouse.move(700, 880);
await p.waitForTimeout(400);
check('click opens and stays open after hover-out', await panel.isVisible());
await p.mouse.click(1250, 18); // top bar text, not a link
check('click outside closes', !(await panel.isVisible()));

// keyboard
await p.mouse.move(5, 880);
await trigger.focus();
await p.keyboard.press('Enter');
check('Enter opens', (await panel.isVisible()) && (await trigger.getAttribute('aria-expanded')) === 'true');
await p.keyboard.press('Tab');
const f1 = await p.evaluate(() => document.activeElement?.textContent?.trim());
await p.keyboard.press('Tab');
const f2 = await p.evaluate(() => document.activeElement?.textContent?.trim());
check(
  'Tab: first category, then its sub-category',
  /^عطر و خوشبوکننده/.test(f1) && /^همه محصولات عطر/.test(f2),
  `${f1} → ${f2}`,
);
const ring = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
check('focus is visible', ring !== 'none', ring);
await p.keyboard.press('Escape');
check(
  'Esc closes and returns focus to the button',
  !(await panel.isVisible()) &&
    (await p.evaluate(() => document.activeElement?.getAttribute('aria-controls'))) !== null,
);

// a link works
await trigger.click();
await panel.getByRole('link', { name: 'کرم تخصصی', exact: true }).hover();
await p.waitForTimeout(250);
// move to the sub-category diagonally, in small steps across the other rows, like a real hand
const from = await panel.getByRole('link', { name: 'کرم تخصصی', exact: true }).boundingBox();
const to = await panel.getByRole('link', { name: /^کرم تخصصی صورت/ }).boundingBox();
await p.mouse.move(from.x + 20, from.y + from.height / 2);
await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 60, { steps: 12 });
await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 });

await panel.getByRole('link', { name: /^کرم تخصصی صورت/ }).click();
await p.waitForURL(/\/c\//);
check(
  'sub-category link navigates and menu closes',
  /\/c\/165/.test(p.url()) && !(await panel.isVisible()),
  decodeURI(p.url()),
);
const h1 = await p.locator('h1').first().innerText();
check('landed on that category', /کرم تخصصی صورت/.test(h1), h1);
await p.close();

// ── mobile ──
const m = await b.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
await m.goto(BASE + '/', { waitUntil: 'load' });
await m.getByRole('button', { name: 'منو' }).click();
const drawer = m.getByRole('dialog');
check('drawer opens', await drawer.isVisible());
const mroots = await drawer.locator('nav > ul > li > details > summary, nav > ul > li > a').allInnerTexts();
check(
  'drawer order = Liateam menu',
  JSON.stringify(mroots.map((t) => t.trim())) === JSON.stringify(LIATEAM),
  mroots.join(' | '),
);
await drawer.getByText('آرایشی', { exact: true }).click();
const open1 = await drawer.locator('details[open] a').allInnerTexts();
check(
  'accordion opens a category with its sub-categories',
  open1.length === 8 && /همه محصولات آرایشی/.test(open1[0]),
  open1.length + ' links',
);
await drawer.getByText('سرم تخصصی', { exact: true }).click();
check(
  'opening another closes the first',
  (await drawer.locator('details[open]').count()) === 1 &&
    /سرم تخصصی/.test(await drawer.locator('details[open] summary').innerText()),
);
const hscroll = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check('no horizontal scroll with the drawer open', !hscroll);
await shot(m, 'menu-mobile.png');
await m.keyboard.press('Escape');
check('Esc closes the drawer', !(await drawer.isVisible()));
await m.getByRole('button', { name: 'منو' }).click();
await m.mouse.click(15, 400); // backdrop (left of the drawer in RTL)
check('tap on backdrop closes', !(await drawer.isVisible()));
await m.getByRole('button', { name: 'منو' }).click();
await drawer.getByText('ضد آفتاب', { exact: true }).click();
await drawer.getByRole('link', { name: /^رنگی/ }).click();
await m.waitForURL(/\/c\/172/);
check('drawer link navigates and drawer closes', !(await drawer.isVisible()), decodeURI(m.url()));
await m.close();

// ── widths ──
for (const w of [390, 768, 1024, 1280, 1440, 1920]) {
  const q = await b.newPage({ viewport: { width: w, height: 900 } });
  await q.goto(BASE + '/', { waitUntil: 'load' });
  if (w >= 1024) await q.getByRole('button', { name: 'دسته‌بندی کالاها' }).click();
  else await q.getByRole('button', { name: 'منو' }).click();
  const over = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(`${w}px: menu open, no horizontal scroll`, over <= 0, `overflow ${over}px`);
  await q.close();
}
await b.close();
finish();
