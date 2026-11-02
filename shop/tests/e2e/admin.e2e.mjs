// The admin panel end to end (desktop): the admin account scripts, who may enter, the shorter admin session and the last
// sign-in, the settings screen (sections, validation, audit), changes that show at once in the header (also after the bot's
// revalidate), write-only masked secrets that never reach the page / the log / the audit, and the shipping ranges (one by
// one and in bulk). Needs the app running locally (SMS_PROVIDER=dev, TRUST_PROXY=1, output in E2E_SERVER_LOG).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { BASE, SCHEMA as S, check, chromium, finish, requireLocalApp, shopRoot, sql } from './_harness.mjs';
import { NET, RUN, ensureProvinces, makeAdmin, signIn, snapshotSettings } from './_admin-login.mjs';

requireLocalApp();
const LOG = process.env.E2E_SERVER_LOG;
const REVALIDATE = process.env.E2E_REVALIDATE_SECRET;
const ADMIN = `0913${RUN}1`;
const CUSTOMER = `0913${RUN}2`;
const SECRET = `sk-live-${RUN}-Zq8wXpLm4421`;
const SECRET2 = `sk-live-${RUN}-Hh3vBnTy9087`;
const user = (phone) => sql(`select id from ${S}.users where phone = '${phone}' and deleted_at is null`);
const setting = (key) => sql(`select value::text from ${S}.site_settings where key = '${key}'`);
const headerHasFree = async (page) => (await page.content()).includes('ارسال رایگان برای خریدهای بالای');

if (Number(sql(`select count(*) from ${S}.commission_rules`)) > 0) {
  console.error(
    'commission_rules is not empty in the local database; the admin tests replace its rows. Empty it first.',
  );
  process.exit(2);
}
if (Number(sql(`select count(*) from ${S}.secret_settings`)) > 0) {
  console.error(
    'secret_settings is not empty in the local database; this test replaces its rows. Empty it first.',
  );
  process.exit(2);
}
const restore = snapshotSettings();
ensureProvinces();
// start from a known shipping state: no ranges of its own
sql(
  `delete from ${S}.shipping_rules where method_id = (select id from ${S}.shipping_methods where code = 'post')`,
);
/** what the bot does after it changed something behind the shop's back */
const botRevalidate = () =>
  REVALIDATE
    ? fetch(`${BASE}/api/internal/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': REVALIDATE },
        body: JSON.stringify({ paths: [{ path: '/shop' }] }),
      })
    : Promise.resolve({ status: 0 });
const browser = await chromium.launch();
const ctxOf = (n) =>
  browser.newContext({
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'x-real-ip': `10.${NET}.${n}.1` },
  });

try {
  // ── 1. the scripts ──
  const first = makeAdmin(ADMIN);
  check(
    '1a admin:create makes the account an admin',
    /is now an admin .*account created/.test(first),
    first.replace(ADMIN, '…'),
  );
  check('1b it is idempotent', /already an admin/.test(makeAdmin(ADMIN)));
  check(
    '1c roles: admin + customer; audit role.grant (admin, via cli) written once',
    sql(
      `select string_agg(role::text, ',' order by role) from ${S}.user_roles where user_id = ${user(ADMIN)}`,
    ) === 'customer,admin' &&
      sql(
        `select count(*) from ${S}.audit_log where action = 'role.grant' and entity_id = '${user(ADMIN)}' and meta->>'role' = 'admin' and meta->>'via' = 'cli'`,
      ) === '1',
  );
  check('1d the number is not echoed in full', !first.includes(ADMIN));

  // ── 2. who may enter ──
  const anon = await ctxOf(1);
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/admin/settings`);
  check(
    '2a anonymous → the login page, coming back to the settings after sign-in',
    /\/login\?next=%2Fadmin%2Fsettings/.test(ap.url()),
    ap.url(),
  );
  const cctx = await ctxOf(2);
  const cp = await cctx.newPage();
  await signIn(cp, CUSTOMER, '/account');
  const forbidden = await cp.goto(`${BASE}/admin/settings`);
  check(
    '2b a customer gets 403 on the settings page',
    forbidden.status() === 403,
    `status ${forbidden.status()}`,
  );
  const forbiddenApi = await cp.request.get(`${BASE}/api/admin/ping`);
  check('2c … and 403 on the admin API', forbiddenApi.status() === 403);

  // ── 3. the admin signs in: last sign-in, shorter session ──
  const actx = await ctxOf(3);
  const page = await actx.newPage();
  await signIn(page, ADMIN, '/admin');
  check(
    '3a the admin reaches /admin',
    page.url().endsWith('/admin') && (await page.locator('[data-last-login]').count()) === 1,
    page.url(),
  );
  check(
    '3b first ever sign-in is said so',
    /اولین ورود/.test(await page.locator('[data-last-login]').innerText()),
  );
  const actx2 = await ctxOf(4);
  const page2 = await actx2.newPage();
  await signIn(page2, ADMIN, '/admin');
  check(
    '3c a later sign-in shows the previous one',
    /آخرین ورود قبلی/.test(await page2.locator('[data-last-login]').innerText()),
  );
  await actx2.close();

  // an admin session older than the limit (8 h) is refused; a customer's session of that age is not touched
  const old = await ctxOf(5);
  const op = await old.newPage();
  await signIn(op, ADMIN, '/admin/settings');
  sql(
    `update ${S}.sessions set created_at = now() - interval '9 hours' where user_id = ${user(ADMIN)} and id = (select max(id) from ${S}.sessions where user_id = ${user(ADMIN)})`,
  );
  await op.goto(`${BASE}/admin/settings`);
  check(
    '3d an admin sign-in older than the limit → the login page with the notice, back to the settings',
    /\/login\?next=%2Fadmin%2Fsettings&expired=1/.test(op.url()) &&
      (await op.getByText('نشست مدیریت منقضی شد').count()) === 1,
    op.url(),
  );
  check('3e … the admin API says 401 too', (await op.request.get(`${BASE}/api/admin/ping`)).status() === 401);
  const acct = await op.goto(`${BASE}/account`);
  check(
    '3f … while the same session still works outside the panel',
    acct.status() === 200 && !op.url().includes('/login'),
    op.url(),
  );
  await old.close();

  // ── 4. the settings screen ──
  await page.goto(`${BASE}/admin/settings`);
  const tabs = await page.locator('[data-settings-tabs] a').allInnerTexts();
  check(
    '4a seven sections, none marked as «not yet in use» any more',
    tabs.length === 7 && tabs.every((t) => !t.includes('S2')),
    tabs.join(' | '),
  );
  check(
    '4b general is the default section',
    (await page.locator('[data-settings-section]').getAttribute('data-settings-section')) === 'general',
  );
  const bad = await page.goto(`${BASE}/admin/settings?section=orders`);
  check(
    '4c the orders section lists its fields',
    bad.status() === 200 && (await page.locator('[data-settings-form="orders"] input').count()) >= 5,
  );

  // invalid → nothing written, a Persian message
  await page.goto(`${BASE}/admin/settings?section=shipping`);
  const extraBefore = setting('shipping.extra_days');
  await page.locator('[data-settings-form="shipping"] [name="shipping.extra_days"]').fill('99');
  await page.locator('[data-settings-form="shipping"]').getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/error=/);
  check(
    '4d an invalid value is refused with a message and nothing is saved',
    (await page.locator('[role=alert]').first().innerText()).includes('روزهای اضافه') &&
      setting('shipping.extra_days') === extraBefore,
  );

  // ── 5. a change shows at once (header), also after the bot's revalidate ──
  sql(`update ${S}.site_settings set value = 'false' where key = 'shipping.free_enabled'`);
  await botRevalidate();
  await page.goto(`${BASE}/shop`); // warm: this page's copy of the settings cache is filled
  await page.goto(`${BASE}/shop`);
  check('5a free shipping off: the header does not promise it', !(await headerHasFree(page)));
  await page.goto(`${BASE}/admin/settings?section=shipping`);
  const sf = page.locator('[data-settings-form="shipping"]');
  await sf.locator('[name="shipping.free_enabled"]').check();
  await sf.locator('[name="shipping.free_from_toman"]').fill('۱٬۲۵۰٬۰۰۰');
  await sf.locator('[name="shipping.extra_days"]').fill('2');
  await sf.getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/done=1/);
  const other = await (await ctxOf(6)).newPage(); // another visitor, right away
  await other.goto(`${BASE}/shop`);
  const text = await other.content();
  check(
    '5b saved: another visitor sees the free-shipping promise at once, with the new threshold',
    text.includes('ارسال رایگان برای خریدهای بالای') && text.includes('۱٬۲۵۰٬۰۰۰'),
  );
  check(
    '5c the stored values are typed JSON',
    setting('shipping.free_enabled') === 'true' &&
      setting('shipping.free_from_toman') === '1250000' &&
      setting('shipping.extra_days') === '2',
  );
  const aud = sql(
    `select meta::text from ${S}.audit_log where action = 'setting.update' and entity_id = 'shipping.free_from_toman' order by id desc limit 1`,
  );
  check(
    '5d audit: who, which key, before and after',
    aud.includes('"after": 1250000') &&
      aud.includes('"before"') &&
      sql(
        `select count(*) from ${S}.audit_log where action = 'setting.update' and entity_id = 'shipping.free_enabled' and actor_user_id = ${user(ADMIN)}`,
      ) === '1',
  );
  check(
    '5e the form shows the saved values',
    (await page.locator('[name="shipping.free_from_toman"]').inputValue()) === '1250000',
  );

  // the bot's revalidate (a change made behind the shop's back) clears the cache at once, not after a minute
  if (REVALIDATE) {
    await other.goto(`${BASE}/shop`);
    sql(`update ${S}.site_settings set value = 'false' where key = 'shipping.free_enabled'`);
    const r = await botRevalidate();
    await other.goto(`${BASE}/shop`);
    check(
      '5f the bot’s revalidate drops the settings cache at once',
      r.status === 200 && !(await headerHasFree(other)),
    );
  } else console.log('• 5f skipped (E2E_REVALIDATE_SECRET not set)');

  // base URL: normalised and validated
  await page.goto(`${BASE}/admin/settings?section=general`);
  const gf = page.locator('[data-settings-form="general"]');
  await gf.locator('[name="site.base_url"]').fill('http://shop.example.com');
  await gf.getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/error=/);
  check(
    '6a an http base URL is refused',
    (await page.locator('[role=alert]').first().innerText()).includes('https'),
  );
  await page
    .locator('[data-settings-form="general"] [name="site.base_url"]')
    .fill('https://shop.example.com/');
  await page.locator('[data-settings-form="general"]').getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/done=1/);
  check(
    '6b an https origin is saved without the trailing slash',
    setting('site.base_url') === '"https://shop.example.com"',
  );

  // ── 7. secrets: write-only, masked, encrypted, never logged or audited ──
  await page.goto(`${BASE}/admin/settings?section=payment`);
  const sec = page.locator('[data-secret="payment.merchant_id"]');
  check(
    '7a an unset secret says so and has a password-type input',
    (await sec.locator('[data-secret-state]').innerText()).includes('تنظیم نشده') &&
      (await sec.locator('input[name=value]').getAttribute('type')) === 'password',
  );
  await sec.locator('input[name=value]').fill('short');
  await sec.getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/error=/);
  check(
    '7b a too-short secret is refused, and the error does not echo it',
    !decodeURIComponent(page.url()).includes('short') && !(await page.content()).includes('>short<'),
  );
  await page.goto(`${BASE}/admin/settings?section=payment`);
  await page.locator('[data-secret="payment.merchant_id"] input[name=value]').fill(SECRET);
  await page.locator('[data-secret="payment.merchant_id"]').getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/secret=1/);
  const html = await page.content();
  const state = await page.locator('[data-secret="payment.merchant_id"] [data-secret-state]').innerText();
  check(
    '7c after saving only the mask shows (••••1234 style), never the value',
    state.includes('••••' + SECRET.slice(-4)) &&
      !html.includes(SECRET) &&
      !html.includes(SECRET.slice(0, -4)),
  );
  check('7d the URL carries no secret either', !decodeURIComponent(page.url()).includes(SECRET));
  const row = sql(
    `select key_version || '|' || octet_length(nonce) || '|' || hint || '|' || (position(convert_to('${SECRET}', 'UTF8') in ciphertext) > 0)::text || '|' || (position(convert_to('${SECRET.slice(-8)}', 'UTF8') in ciphertext) > 0)::text from ${S}.secret_settings where key = 'payment.merchant_id'`,
  );
  check(
    '7e stored encrypted: version 1, 12-byte nonce, hint = last 4, no plaintext in the ciphertext',
    row === `1|12|${SECRET.slice(-4)}|false|false`,
    row.replace(SECRET.slice(-4), '****'),
  );
  const nonce1 = sql(
    `select encode(nonce, 'hex') from ${S}.secret_settings where key = 'payment.merchant_id'`,
  );
  await page.locator('[data-secret="payment.merchant_id"] input[name=value]').fill(SECRET2);
  await page.locator('[data-secret="payment.merchant_id"]').getByRole('button', { name: 'تعویض' }).click();
  await page.waitForURL(/secret=1/);
  const nonce2 = sql(
    `select encode(nonce, 'hex') from ${S}.secret_settings where key = 'payment.merchant_id'`,
  );
  check(
    '7f replacing re-encrypts with a new nonce, and the mask follows',
    nonce1 !== nonce2 &&
      (await page.locator('[data-secret-state]').first().innerText()).includes('••••' + SECRET2.slice(-4)),
  );
  const audits = sql(
    `select string_agg(meta::text, ' ') from ${S}.audit_log where action = 'secret.update' and entity_id = 'payment.merchant_id' and actor_user_id = ${user(ADMIN)}`,
  );
  check(
    '7g audit: «changed» only — no value, no hint, no length',
    /"changed": true/.test(audits) &&
      !audits.includes(SECRET.slice(-4)) &&
      !audits.includes(SECRET2.slice(-4)) &&
      sql(
        `select count(*) from ${S}.audit_log where action = 'secret.update' and entity_id = 'payment.merchant_id' and actor_user_id = ${user(ADMIN)}`,
      ) === '2',
  );
  const everything = sql(`select string_agg(meta::text || coalesce(entity_id, ''), ' ') from ${S}.audit_log`);
  check(
    '7h no secret anywhere in the audit log',
    !everything.includes(SECRET) && !everything.includes(SECRET2) && !everything.includes(SECRET.slice(-8)),
  );
  check(
    '7i … nor in the server log',
    !fs.readFileSync(LOG, 'utf8').includes(SECRET.slice(-10)) &&
      !fs.readFileSync(LOG, 'utf8').includes(SECRET2.slice(-10)),
  );
  check(
    '7j the app role has no DELETE on secret_settings and no DDL',
    sql(
      `select has_table_privilege('lia_shop_staging', '${S}.secret_settings', 'DELETE')::text || has_table_privilege('lia_shop_staging', '${S}.secret_settings', 'INSERT')::text || has_schema_privilege('lia_shop_staging', '${S}', 'CREATE')::text`,
    ) === 'falsetruefalse',
  );
  const paymentText = await page.locator('main').innerText();
  check(
    '7k the payment section no longer says it is unused',
    !paymentText.includes('S2') && !paymentText.includes('هنوز در جریان'),
  );

  // ── 8. shipping ranges ──
  await page.goto(`${BASE}/admin/settings?section=shipping`);
  const form = page.locator('[data-shipping-form]');
  check('8a the form lists the provinces', (await form.locator('[data-province]').count()) >= 3);
  await form.locator('[name="label"]').fill('پست پیشتاز');
  await form.locator('[name="fallback.min"]').fill('۳');
  await form.locator('[name="fallback.max"]').fill('۶');
  const row0 = form.locator('[data-province]').nth(0);
  const firstId = await row0.getAttribute('data-province');
  await row0.locator('input[name$=".min"]').fill('1');
  await row0.locator('input[name$=".max"]').fill('2');
  await form.getByRole('button', { name: 'ذخیره‌ی تنظیمات ارسال' }).click();
  await page.waitForURL(/shipped=1/);
  const rules = sql(
    `select string_agg(coalesce(province_id::text, 'all') || ':' || eta_min_days || '-' || eta_max_days || ':' || active, ',' order by province_id nulls first) from ${S}.shipping_rules where method_id = (select id from ${S}.shipping_methods where code = 'post')`,
  );
  check(
    '8b label, the fallback range and one province range are saved',
    rules.includes('all:3-6:true') &&
      rules.includes(`${firstId}:1-2:true`) &&
      sql(`select label from ${S}.shipping_methods where code = 'post'`) === 'پست پیشتاز',
    rules,
  );
  check('8c a province left blank gets no rule of its own', rules.split(',').length === 2, rules);

  // bulk: tick two provinces, apply 4–7
  await page.goto(`${BASE}/admin/settings?section=shipping`);
  const bform = page.locator('[data-shipping-form]');
  const rows = bform.locator('[data-province]');
  await rows.nth(1).locator('input[name=sel]').check();
  await rows.nth(2).locator('input[name=sel]').check();
  await bform.locator('[name="bulk.min"]').fill('4');
  await bform.locator('[name="bulk.max"]').fill('7');
  await bform.locator('[data-bulk-apply]').click();
  await page.waitForURL(/shipped=1/);
  const id1 = await page.locator('[data-province]').nth(1).getAttribute('data-province');
  const id2 = await page.locator('[data-province]').nth(2).getAttribute('data-province');
  const rules2 = sql(
    `select string_agg(province_id::text || ':' || eta_min_days || '-' || eta_max_days || ':' || active, ',') from ${S}.shipping_rules where method_id = (select id from ${S}.shipping_methods where code = 'post') and province_id is not null`,
  );
  check(
    '8d the bulk range lands on the two ticked provinces; the first keeps its own',
    rules2.includes(`${id1}:4-7:true`) &&
      rules2.includes(`${id2}:4-7:true`) &&
      rules2.includes(`${firstId}:1-2:true`),
    rules2,
  );
  check(
    '8e the saved ranges are in the form again',
    (await page.locator('[data-province]').nth(1).locator('input[name$=".min"]').inputValue()) === '4',
  );

  // bulk with nothing ticked / a bad row → refused
  await page.locator('[data-bulk-apply]').click();
  await page.waitForURL(/error=/);
  check(
    '8f bulk with nothing ticked is refused',
    (await page.locator('[role=alert]').first().innerText()).includes('تیک'),
  );
  await page.goto(`${BASE}/admin/settings?section=shipping`);
  await page.locator('[data-province]').nth(0).locator('input[name$=".min"]').fill('9');
  await page.locator('[data-province]').nth(0).locator('input[name$=".max"]').fill('3');
  await page.locator('[data-shipping-form]').getByRole('button', { name: 'ذخیره‌ی تنظیمات ارسال' }).click();
  await page.waitForURL(/error=/);
  check(
    '8g a range with max below min is refused and nothing changes',
    sql(
      `select eta_max_days from ${S}.shipping_rules where province_id = ${firstId} and method_id = (select id from ${S}.shipping_methods where code = 'post')`,
    ) === '2',
  );

  // clearing a row keeps it (the app role cannot delete) but switches it off
  await page.goto(`${BASE}/admin/settings?section=shipping`);
  await page.locator('[data-province]').nth(0).locator('input[name$=".min"]').fill('');
  await page.locator('[data-province]').nth(0).locator('input[name$=".max"]').fill('');
  await page.locator('[data-shipping-form]').getByRole('button', { name: 'ذخیره‌ی تنظیمات ارسال' }).click();
  await page.waitForURL(/shipped=1/);
  check(
    '8h a cleared province range is switched off, not deleted',
    sql(
      `select active::text from ${S}.shipping_rules where province_id = ${firstId} and method_id = (select id from ${S}.shipping_methods where code = 'post')`,
    ) === 'false',
  );
  check(
    '8i shipping changes are audited',
    Number(
      sql(
        `select count(*) from ${S}.audit_log where action = 'shipping.update' and actor_user_id = ${user(ADMIN)}`,
      ),
    ) >= 3,
  );

  // ── 10. responsive gate: no sideways page scroll from 360 to 1920 on every section (and the panel's home) ──
  const over = [];
  for (const [w, h] of [
    [360, 780],
    [390, 844],
    [768, 1024],
    [1024, 800],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const path of [
      '/admin',
      ...['general', 'orders', 'shipping', 'commission', 'sms', 'payment'].map(
        (g) => `/admin/settings?section=${g}`,
      ),
    ]) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      if ((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) > 1)
        over.push(`${path}@${w}`);
    }
  }
  check(
    '10 no sideways scroll at 360 / 390 / 768 / 1024 / 1280 / 1440 / 1920 on the panel and all six sections',
    over.length === 0,
    over.join(', '),
  );

  // ── 9. revoking ──
  const rev = execSync(`npm run admin:revoke -- --mobile=${ADMIN} --allow-last`, {
    cwd: shopRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .at(-1);
  check(
    '9a admin:revoke removes the role and signs the admin out',
    /no longer an admin/.test(rev) &&
      sql(`select count(*) from ${S}.user_roles where user_id = ${user(ADMIN)} and role = 'admin'`) === '0',
  );
  await page.goto(`${BASE}/admin/settings`);
  check('9b the signed-out admin lands on the login page', page.url().includes('/login'), page.url());
  check(
    '9c audit role.revoke',
    sql(
      `select count(*) from ${S}.audit_log where action = 'role.revoke' and entity_id = '${user(ADMIN)}'`,
    ) === '1',
  );
} finally {
  try {
    await restore();
  } catch (e) {
    console.error('restore failed:', e.message);
  }
  await browser.close();
}
finish();
