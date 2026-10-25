// Sync health (G-3; local app + Docker DB with grants 013):
//  1. /health has the minutes since the last successful catalog sync and the pause state
//  2. /admin shows «وضعیت همگام‌سازی» (last sync, products, events in 24 h, last revalidate, schedule) to an admin;
//     no event text or price in it
//  3. a revalidate call is recorded as «آخرین تازه‌سازی»
import { execSync } from 'node:child_process';
import { BASE, check, chromium, finish, requireLocalApp, shopRoot, signIn } from './_harness.mjs';

requireLocalApp();
const stamp = String(Date.now()).slice(-6);
const secret = process.env.E2E_REVALIDATE_SECRET;

const health = await (await fetch(`${BASE}/health`)).json();
check(
  '1 /health: sync.lastOkMinutesAgo is a number, paused a yes/no',
  typeof health.checks?.sync?.lastOkMinutesAgo === 'number' &&
    typeof health.checks?.sync?.paused === 'boolean',
  JSON.stringify(health.checks?.sync),
);

if (secret) {
  const r = await fetch(`${BASE}/api/internal/revalidate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
    body: JSON.stringify({ paths: [{ path: '/' }] }),
  });
  check('3a revalidate accepted', r.status === 200, String(r.status));
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'x-real-ip': `10.86.1.${1 + (Date.now() % 200)}` },
  });
  const p = await ctx.newPage();
  await signIn(p, `0912${stamp}5`);
  execSync(`npm run grant-role -- 0912${stamp}5 admin`, { cwd: shopRoot, encoding: 'utf8' });
  await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
  const card = p.locator('[data-sync-status]');
  const text = (await card.innerText()).replace(/\s+/g, ' ');
  check(
    '2a admin: the sync card with its six lines',
    [
      'آخرین همگام‌سازی کاتالوگ',
      'آخرین همگام‌سازی موفق',
      'محصولات قابل نمایش',
      'رویدادهای تغییر',
      'آخرین تازه‌سازی',
      'زمان‌بندی',
    ].every((t) => text.includes(t)),
    text.slice(0, 200),
  );
  check('2b no prices or event texts in the card', !/تومان|قیمت از/.test(text));
  if (secret)
    check('3b «آخرین تازه‌سازی» has a time', !/آخرین تازه‌سازی صفحه‌ها \(revalidate\) —/.test(text), text);
  const cust = await browser.newContext({
    extraHTTPHeaders: { 'x-real-ip': `10.86.2.${1 + (Date.now() % 200)}` },
  });
  const c = await cust.newPage();
  await signIn(c, `0912${stamp}6`);
  check('2c a customer gets 403 on /admin', (await c.goto(`${BASE}/admin`)).status() === 403);
} finally {
  await browser.close();
}
finish();
