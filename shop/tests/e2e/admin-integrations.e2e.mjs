// Payment gateway, SMS and commission settings in the admin panel (desktop): changing the provider, masked write-only keys,
// the harmless connection test, the test SMS to the admin's own number (rate-limited), event templates, OTP through the
// active provider and its sms_log row, the commission rules editor (no defaults) and the simulator. Nothing here reaches
// a real gateway or SMS service: the dev provider is used and the connection test is a local format check.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { BASE, SCHEMA as S, check, chromium, finish, requireLocalApp, sql, toLatin } from './_harness.mjs';
import { NET, RUN, makeAdmin, signIn, snapshotSettings } from './_admin-login.mjs';

requireLocalApp();
const LOG = process.env.E2E_SERVER_LOG;
for (const t of ['secret_settings', 'commission_rules'])
  if (Number(sql(`select count(*) from ${S}.${t}`)) > 0) {
    console.error(`${t} is not empty in the local database; this test replaces its rows. Empty it first.`);
    process.exit(2);
  }
const restore = snapshotSettings();
const ADMIN = `0915${RUN}1`;
const CUSTOMER = `0915${RUN}2`;
const MERCHANT = randomUUID();
const API_KEY = `gw-key-${RUN}-Xk9PqLm2208`;
const SMS_KEY = `sms-key-${RUN}-Vb7NhTy3315`;
const setting = (key) => sql(`select value::text from ${S}.site_settings where key = '${key}'`);
const num = (t) => Number(toLatin(t));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: { 'x-real-ip': `10.${NET}.40.1` },
});
const page = await ctx.newPage();
const section = (g, extra = '') => page.goto(`${BASE}/admin/settings?section=${g}${extra}`);
const save = async (g) => {
  await page.locator(`[data-settings-form="${g}"]`).getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/(done|error)=/);
};
const alertText = async () =>
  (await page.locator('[role=alert]').filter({ hasText: /\S/ }).first().innerText()).trim();

try {
  makeAdmin(ADMIN);
  await signIn(page, ADMIN, '/admin/settings');
  const adminId = sql(`select id from ${S}.users where phone = '${ADMIN}' and deleted_at is null`);

  // ── 1. payment provider ──
  await section('payment');
  const form = page.locator('[data-settings-form="payment"]');
  check(
    '1a defaults: zarinpal chosen, sandbox on, payment off',
    (await form.locator('input[name="payment.provider"]:checked').getAttribute('value')) === 'zarinpal' &&
      (await form.locator('[name="payment.sandbox"]').isChecked()) &&
      !(await form.locator('[name="payment.enabled"]').isChecked()),
  );
  check(
    '1b the unverified gateway says so in its label',
    (
      await form.locator('input[name="payment.provider"][value="zarinpal"]').locator('xpath=..').innerText()
    ).includes('تأییدنشده'),
  );
  await form.locator('[name="payment.enabled"]').check();
  await form.locator('input[name="payment.provider"][value="dev"]').check();
  await save('payment');
  check(
    '1c provider changed to the simulator and payment switched on; audited with before and after',
    setting('payment.provider') === '"dev"' &&
      setting('payment.enabled') === 'true' &&
      sql(
        `select meta::text from ${S}.audit_log where action = 'setting.update' and entity_id = 'payment.provider' and actor_user_id = ${adminId} order by id desc limit 1`,
      ).includes('"after": "dev"'),
  );
  await section('payment');
  await page
    .locator('[data-settings-form="payment"] input[name="payment.provider"][value="zarinpal"]')
    .check();
  await save('payment');
  check('1d and back to zarinpal', setting('payment.provider') === '"zarinpal"');

  // ── 2. keys: write-only, masked, encrypted ──
  await section('payment');
  for (const [key, value] of [
    ['payment.merchant_id', MERCHANT],
    ['payment.api_key', API_KEY],
  ]) {
    const sec = page.locator(`[data-secret="${key}"]`);
    await sec.locator('input[name=value]').fill(value);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      sec.getByRole('button', { name: /ذخیره|تعویض/ }).click(),
    ]);
    await page.waitForLoadState('load');
    await page.goto(`${BASE}/admin/settings?section=payment`);
  }
  const html = await page.content();
  const masks = await page.locator('[data-secret-state]').allInnerTexts();
  check(
    '2a both keys show only ••••last4; the values are nowhere in the page',
    masks.some((m) => m.includes('••••' + MERCHANT.slice(-4))) &&
      masks.some((m) => m.includes('••••' + API_KEY.slice(-4))) &&
      !html.includes(MERCHANT) &&
      !html.includes(API_KEY),
  );
  check(
    '2b the inputs are password fields that start empty',
    await page
      .locator('[data-secret] input[name=value]')
      .evaluateAll((els) => els.every((e) => e.type === 'password' && e.value === '')),
  );
  check(
    '2c stored encrypted (no plaintext in the ciphertext)',
    sql(
      `select count(*) from ${S}.secret_settings where position(convert_to('${API_KEY.slice(-8)}', 'UTF8') in ciphertext) > 0 or position(convert_to('${MERCHANT.slice(-12)}', 'UTF8') in ciphertext) > 0`,
    ) === '0',
  );

  // ── 3. «تست اتصال»: a harmless check, no transaction ──
  await page.goto(`${BASE}/admin/settings?section=general`);
  await page
    .locator('[data-settings-form="general"] [name="site.base_url"]')
    .fill('https://shop.example.com');
  await save('general');
  await section('payment');
  await page.locator('[data-payment-test] button').click();
  await page.waitForURL(/test=/);
  const okMsg = await page.locator('[data-test-result="ok"]').innerText();
  check(
    '3a the test passes with a well-formed merchant id and a base URL, and warns the gateway is unverified',
    okMsg.includes('قالب شناسه‌ی پذیرنده درست') && okMsg.includes('آزمایش نشده'),
    okMsg.slice(0, 80),
  );
  await section('payment');
  const sec = page.locator('[data-secret="payment.merchant_id"]');
  await sec.locator('input[name=value]').fill('abcdefgh12');
  await sec.getByRole('button', { name: 'تعویض' }).click();
  await page.waitForURL(/secret=1/);
  await page.locator('[data-payment-test] button').click();
  await page.waitForURL(/test=/);
  check(
    '3b a malformed merchant id fails the test',
    (await page.locator('[data-test-result="fail"]').count()) === 1,
  );
  check(
    '3c the tests are audited with the outcome only',
    sql(
      `select string_agg((meta->>'ok'), ',' order by id) from ${S}.audit_log where action = 'payment.test' and actor_user_id = ${adminId}`,
    ) === 'true,false',
  );
  check(
    '3d the callback address in the redirect/message carries no key',
    !decodeURIComponent(page.url()).includes(MERCHANT) && !decodeURIComponent(page.url()).includes(API_KEY),
  );

  // ── 4. sms settings ──
  await section('sms');
  const sms = page.locator('[data-settings-form="sms"]');
  check(
    '4a the sms section has the provider, sender, otp template and five events with a switch and a template each',
    (await sms.locator('input[name="sms.provider"]').count()) === 4 &&
      (await sms.locator('[name^="sms.event."][name$=".template"]').count()) === 5 &&
      (await sms.locator('[name^="sms.event."][name$=".enabled"]').count()) === 5,
  );
  check(
    '4b every event switch starts off; the default provider is the server setting',
    (await sms.locator('[name^="sms.event."][name$=".enabled"]:checked').count()) === 0 &&
      (await sms.locator('input[name="sms.provider"]:checked').getAttribute('value')) === 'env',
  );
  check(
    '4c the allowed variables are listed for the shipped event',
    (await sms.innerText()).includes('{order_no} {tracking}'),
  );
  await sms.locator('input[name="sms.provider"][value="dev"]').check();
  await sms.locator('[name="sms.sender"]').fill('3000505');
  await sms.locator('[name="sms.otp_template"]').fill('login-otp');
  await sms.locator('[name="sms.event.shipped.enabled"]').check();
  await sms.locator('[name="sms.event.shipped.template"]').fill('shipped-pattern');
  await save('sms');
  check(
    '4d provider, line, otp template and the shipped event are saved',
    setting('sms.provider') === '"dev"' &&
      setting('sms.sender') === '"3000505"' &&
      setting('sms.otp_template') === '"login-otp"' &&
      setting('sms.event.shipped.enabled') === 'true' &&
      setting('sms.event.shipped.template') === '"shipped-pattern"',
  );
  await section('sms');
  await page.locator('[data-settings-form="sms"] [name="sms.event.canceled.template"]').fill('bad code!');
  await save('sms');
  check(
    '4e a malformed template code is refused and nothing is saved',
    (await alertText()).includes('کد الگو') && !setting('sms.event.canceled.template').includes('bad'),
  );

  // ── 5. test SMS: only to the admin's own number, rate-limited, logged without text ──
  const sendTest = async () => {
    await section('sms');
    await page.locator('[data-sms-test] button').click();
    await page.waitForURL(/(test|error)=/);
  };
  await sendTest();
  const sent = await page.locator('[data-test-result="ok"]').innerText();
  check("5a the test SMS goes to the admin's own masked number", sent.includes('•••'), sent.slice(0, 70));
  const row = sql(
    `select purpose || '|' || provider || '|' || status || '|' || coalesce(error, '') from ${S}.sms_log where phone = '${ADMIN}' order by id desc limit 1`,
  );
  check('5b sms_log: purpose other, provider dev, sent, no error', row === 'other|dev|sent|', row);
  await sendTest();
  await sendTest();
  await sendTest();
  check(
    '5c the fourth test within ten minutes is refused',
    (await alertText()).includes('بیش از حد') &&
      Number(sql(`select count(*) from ${S}.sms_log where phone = '${ADMIN}' and purpose = 'other'`)) === 3,
  );
  check(
    '5d sms_log has no column that could hold a code or a text',
    sql(
      `select string_agg(column_name, ',') from information_schema.columns where table_schema = '${S}' and table_name = 'sms_log' and column_name in ('text', 'body', 'message', 'code')`,
    ) === '',
  );

  // ── 6. the login code goes through the active provider ──
  const cust = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { 'x-real-ip': `10.${NET}.41.1` },
    })
  ).newPage();
  await signIn(cust, CUSTOMER, '/account');
  check(
    '6a a customer signs in with the code sent by the provider chosen in the panel (dev)',
    cust.url().endsWith('/account'),
    cust.url(),
  );
  const otpRow = sql(
    `select purpose || '|' || provider || '|' || status from ${S}.sms_log where phone = '${CUSTOMER}' order by id desc limit 1`,
  );
  check('6b … and it is in sms_log as otp / dev / sent', otpRow === 'otp|dev|sent', otpRow);

  // ── 7. nothing secret in the audit log or the server log ──
  await section('sms');
  const smsSec = page.locator('[data-secret="sms.api_key"]');
  await smsSec.locator('input[name=value]').fill(SMS_KEY);
  await smsSec.getByRole('button', { name: 'ذخیره' }).click();
  await page.waitForURL(/secret=1/);
  const audit = sql(`select string_agg(meta::text || coalesce(entity_id, ''), ' ') from ${S}.audit_log`);
  const log = LOG ? fs.readFileSync(LOG, 'utf8') : '';
  check('7a no key in the audit log', ![MERCHANT, API_KEY, SMS_KEY].some((k) => audit.includes(k.slice(-8))));
  check('7b no key in the server log', ![MERCHANT, API_KEY, SMS_KEY].some((k) => log.includes(k.slice(-8))));
  check(
    '7c secret_settings has the three keys, each with a nonce',
    sql(`select count(distinct nonce) from ${S}.secret_settings`) === '3',
  );

  // ── 8. commission rules and the simulator ──
  const commissionsBefore = sql(`select count(*) from ${S}.commissions`);
  await section('commission');
  check(
    '8a no rule exists and the form starts empty (no default values)',
    (await page.locator('[data-rules]').count()) === 0 &&
      (await page.locator('[data-rule-form] [name="value"]').inputValue()) === '' &&
      (await page.locator('[data-rule-form] [name="holdDays"]').inputValue()) === '' &&
      (await page.locator('[data-rule-form] [name="level"]').inputValue()) === '',
  );
  // the browser would stop an empty form (required fields); switch that off to prove the server refuses it too
  await page.locator('[data-rule-form]').evaluate((f) => (f.noValidate = true));
  await page.locator('[data-rule-form]').getByRole('button', { name: 'افزودن قاعده' }).click();
  await page.waitForURL(/error=/);
  check(
    '8b an empty form is refused (nothing is filled in for the admin)',
    Number(sql(`select count(*) from ${S}.commission_rules`)) === 0,
  );
  const addRule = async () => {
    await page.locator('[data-rule-form]').getByRole('button', { name: 'افزودن قاعده' }).click();
    await page.waitForURL(/(done|error)=/);
    if (page.url().includes('error=')) throw new Error(`rule refused: ${await alertText()}`);
  };
  const fillRule = async (o) => {
    const f = page.locator('[data-rule-form]');
    for (const [k, v] of Object.entries(o)) {
      if (k === 'scope' || k === 'kind') await f.locator(`[name="${k}"]`).selectOption(v);
      else await f.locator(`[name="${k}"]`).fill(v);
    }
  };
  await section('commission');
  await fillRule({
    name: 'پایه سطح یک',
    level: '1',
    scope: 'all',
    kind: 'percent',
    value: '5',
    minOrderTotal: '0',
    holdDays: '7',
  });
  await page.locator('[data-rule-form] [name="active"]').check();
  await addRule();
  await section('commission');
  await fillRule({
    name: 'برند ویژه',
    level: '1',
    scope: 'brand',
    scopeId: '10',
    kind: 'percent',
    value: '10',
    minOrderTotal: '0',
    maxPerOrder: '60000',
    holdDays: '14',
  });
  await page.locator('[data-rule-form] [name="active"]').check();
  await addRule();
  await section('commission');
  await fillRule({
    name: 'سطح دو',
    level: '2',
    scope: 'all',
    kind: 'fixed',
    value: '7000',
    minOrderTotal: '0',
    holdDays: '0',
  });
  await page.locator('[data-rule-form] [name="active"]').check();
  await addRule();
  check(
    '8c three rules saved and listed; audited',
    (await page.locator('[data-rules] [data-rule]').count()) === 3 &&
      Number(
        sql(
          `select count(*) from ${S}.audit_log where action = 'commission_rule.create' and actor_user_id = ${adminId}`,
        ),
      ) === 3,
  );
  const brandId = sql(`select id from ${S}.commission_rules where name = 'برند ویژه'`);
  check(
    '8d stored with the scope, level, cap and hold',
    sql(
      `select scope_type || ':' || scope_id || ':' || level || ':' || kind || ':' || value || ':' || max_per_order || ':' || hold_days from ${S}.commission_rules where id = ${brandId}`,
    ) === 'brand:10:1:percent:10.0000:60000:14',
  );

  // edit: switch the brand rule's value
  await section('commission', `&edit=${brandId}`);
  check(
    '8e the edit form shows the saved rule',
    (await page.locator('[data-rule-form] [name="value"]').inputValue()) === '10' &&
      (await page.locator('[data-rule-form] [name="name"]').inputValue()) === 'برند ویژه',
  );
  await page.locator('[data-rule-form] [name="value"]').fill('12');
  await page.locator('[data-rule-form]').getByRole('button', { name: 'ذخیره‌ی قاعده' }).click();
  await page.waitForURL(/done=1/);
  check(
    '8f the edit is saved and audited',
    sql(`select value::text from ${S}.commission_rules where id = ${brandId}`) === '12.0000' &&
      Number(
        sql(
          `select count(*) from ${S}.audit_log where action = 'commission_rule.update' and entity_id = '${brandId}'`,
        ),
      ) === 1,
  );

  // simulator: brand-10 goods earn 12% capped at 60,000 on level 1; level 2 is a fixed 7,000; level 3 has no rule
  const simulate = async (q) => {
    await page.goto(`${BASE}/admin/settings?section=commission&${new URLSearchParams(q)}`);
    await page.locator('[data-sim-result]').waitFor();
  };
  const levelAmount = async (n) =>
    num(await page.locator(`[data-sim-level="${n}"] [data-sim-amount]`).innerText());
  await simulate({ 'l1.total': '300000', 'l1.brand': '10', depth: '3', status: 'paid', held: '0' });
  check(
    '8g simulator: level 1 = 12% of 300,000 (brand rule beats the general one), level 2 = the fixed 7,000, level 3 has no rule',
    (await levelAmount(1)) === 36_000 &&
      (await levelAmount(2)) === 7_000 &&
      (await page.locator('[data-sim-skipped="3"]').count()) === 1,
  );
  await simulate({ 'l1.total': '1000000', 'l1.brand': '10', depth: '1', status: 'paid', held: '0' });
  check('8h the cap: 12% of 1,000,000 is limited to 60,000', (await levelAmount(1)) === 60_000);
  await simulate({ 'l1.total': '1000000', 'l1.brand': '99', depth: '1', status: 'paid', held: '0' });
  check('8i another brand falls back to the general 5% (50,000)', (await levelAmount(1)) === 50_000);
  await simulate({ 'l1.total': '1000000', depth: '1', status: 'sent', held: '8' });
  check(
    '8j a sent order held 7 days: approved after 8',
    (await page.locator('[data-sim-level="1"]').innerText()).includes('قابل تأیید'),
  );
  await simulate({ 'l1.total': '1000000', depth: '1', status: 'sent', held: '3' });
  check(
    '8k … still pending after 3 days',
    (await page.locator('[data-sim-level="1"]').innerText()).includes('در انتظار'),
  );
  await simulate({ 'l1.total': '1000000', depth: '2', status: 'refunded', held: '0' });
  check(
    '8l a refunded order: every level cancelled with zero',
    (await levelAmount(1)) === 0 && (await page.locator('[data-sim-level="1"]').innerText()).includes('لغو'),
  );
  await simulate({ 'l1.total': '1000000', depth: '0', status: 'paid', held: '0' });
  check(
    '8m a buyer with no referrer earns nobody anything',
    (await page.locator('[data-sim-result]').innerText()).includes('معرف ندارد'),
  );
  check(
    '8n the simulator stored nothing',
    sql(`select count(*) from ${S}.commissions`) === commissionsBefore &&
      Number(sql(`select count(*) from ${S}.commission_rules`)) === 3,
  );
  check(
    '8o the app role cannot delete rules',
    sql(
      `select has_table_privilege('lia_shop_staging', '${S}.commission_rules', 'DELETE')::text || has_table_privilege('lia_shop_staging', '${S}.commission_rules', 'UPDATE')::text`,
    ) === 'falsetrue',
  );

  // ── 9. responsive: 360 – 1920 on the three sections (with rules, results and forms on screen) ──
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
    for (const url of [
      'payment',
      'sms',
      'commission&l1.total=300000&l1.brand=10&depth=3&status=paid&held=0',
    ]) {
      await page.goto(`${BASE}/admin/settings?section=${url}`, { waitUntil: 'load' });
      if ((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) > 1)
        over.push(`${url.split('&')[0]}@${w}`);
    }
  }
  check(
    '9 no sideways scroll from 360 to 1920 on payment, sms and commission',
    over.length === 0,
    over.join(', '),
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
