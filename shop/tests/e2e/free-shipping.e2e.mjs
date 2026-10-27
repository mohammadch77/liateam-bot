// «ارسال رایگان از مبلغ X» in the header comes from the order settings (shipping.free_enabled / shipping.free_from_toman):
// with the switch off (the starting value) nothing is promised; with it on the header shows the amount from the setting.
// Flips the two settings and restores them. Needs E2E_REVALIDATE_SECRET (the app's settings cache is cleared by it).
import { BASE, SCHEMA, check, chromium, fa, finish, requireLocalApp, sleep, sql } from './_harness.mjs';

requireLocalApp();
const secret = process.env.E2E_REVALIDATE_SECRET;
if (!secret) {
  console.error('E2E_REVALIDATE_SECRET is not set (needed to clear the settings cache)');
  process.exit(2);
}
const setting = (key) => sql(`select value::text from ${SCHEMA}.site_settings where key = '${key}'`);
const put = (key, json) =>
  sql(
    `insert into ${SCHEMA}.site_settings (key, value, updated_at) values ('${key}', '${json}'::jsonb, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
  );
const refresh = () =>
  fetch(`${BASE}/api/internal/revalidate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
    body: JSON.stringify({ paths: [{ path: '/' }] }),
  });
const before = { enabled: setting('shipping.free_enabled'), from: setting('shipping.free_from_toman') };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const headerText = async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  return (await page.locator('header').first().innerText()).replace(/\s+/g, ' ');
};
// the app caches the settings for a minute and the revalidate call may not reach that cache (separate server bundles):
// poll until the header shows the new state, at most ~75 s
const until = async (want, tries = 16) => {
  let t = '';
  for (let i = 0; i < tries; i++) {
    t = await headerText();
    if (want(t)) return t;
    await sleep(5000);
  }
  return t;
};
try {
  put('shipping.free_enabled', 'false');
  put('shipping.free_from_toman', '999000');
  await refresh();
  let t = await until((x) => !x.includes('ارسال رایگان'));
  check('1 switch off: the header promises no free shipping', !t.includes('ارسال رایگان'), t.slice(0, 120));

  put('shipping.free_enabled', 'true');
  put('shipping.free_from_toman', '1250000');
  await refresh();
  t = await until((x) => x.includes(fa(1250000)));
  check(
    '2 switch on: «ارسال رایگان … ۱٬۲۵۰٬۰۰۰ تومان» (the amount of the setting)',
    t.includes('ارسال رایگان') && t.includes(fa(1250000)),
    t.slice(0, 160),
  );

  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  check(
    '3 phone: the promo line shows the same amount',
    (await m.locator('header').first().innerText()).includes(fa(1250000)),
  );
  await m.close();

  put('shipping.free_enabled', 'false');
  await refresh();
  t = await until((x) => !x.includes('ارسال رایگان'));
  check('4 switched off again: the line is gone', !t.includes('ارسال رایگان'));
} finally {
  put('shipping.free_enabled', before.enabled || 'false');
  put('shipping.free_from_toman', before.from || '999000');
  await refresh().catch(() => {});
  await browser.close();
}
finish();
