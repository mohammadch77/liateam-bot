// Shared by the admin end-to-end tests: make an admin with the real script, sign in by the real OTP flow (the dev SMS
// provider prints the code to E2E_SERVER_LOG), and snapshot / restore the settings the tests change.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { BASE, SCHEMA, shopRoot, sleep, sql } from './_harness.mjs';

const LOG = process.env.E2E_SERVER_LOG;
if (!LOG || !fs.existsSync(LOG)) {
  console.error(
    'set E2E_SERVER_LOG to the file the app writes its output to (dev SMS codes are read from it)',
  );
  process.exit(2);
}

export const RUN = String(Date.now()).slice(-6);
export const NET = 1 + (Date.now() % 250); // fresh client IPs every run (the per-IP quota is per hour)
export const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

/** `npm run admin:create` (the real script); returns its last output line */
export function makeAdmin(phone) {
  const out = execSync(`npm run admin:create -- --mobile=${phone}`, { cwd: shopRoot, encoding: 'utf8' });
  return out.trim().split('\n').at(-1);
}

async function codeFor(phone, after) {
  const masked = `${phone.slice(0, 4)}•••${phone.slice(-4)}`;
  for (let i = 0; i < 40; i++) {
    const lines = fs
      .readFileSync(LOG, 'utf8')
      .split('\n')
      .filter((l) => l.includes('sms.dev.otp') && l.includes(masked));
    if (lines.length > after) return JSON.parse(lines.at(-1).slice(lines.at(-1).indexOf('{'))).devCode;
    await sleep(300);
  }
  throw new Error('no code in log for ' + masked);
}
const codesSent = (phone) => {
  const masked = `${phone.slice(0, 4)}•••${phone.slice(-4)}`;
  return fs
    .readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((l) => l.includes('sms.dev.otp') && l.includes(masked)).length;
};

/** the page ends signed in (phone → code → session); `next` is where the login page sends it */
export async function signIn(page, phone, next = '/admin') {
  // the same number signs in several times in one run: forget its earlier codes so the resend cooldown does not stop it
  sql(`delete from ${SCHEMA}.otp_codes where phone = '${phone}'`);
  const before = codesSent(phone);
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.locator('main').getByLabel('شماره موبایل').fill(phone);
  await page.getByRole('button', { name: 'دریافت کد تأیید' }).click();
  const code = await codeFor(phone, before);
  await page.getByRole('textbox', { name: 'کد تأیید', exact: true }).fill(code);
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 }).catch(() => {}),
    page.getByRole('button', { name: 'ورود', exact: true }).click(),
  ]);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {});
}

const KEYS = `'orders.price_tolerance_toman','orders.auto_place_enabled','orders.auto_place_hours','shipping.free_enabled','shipping.free_from_toman','shipping.extra_days','seo.block_indexing','pricing.discount_mode','site.base_url','security.admin_session_hours','commission.default_percent'`;

/** Remembers the settings, the «post» method with its rules and the secrets; returns a function that puts them back. */
export function snapshotSettings() {
  const settings = sql(
    `select coalesce(json_agg(json_build_object('k', key, 'v', value)), '[]') from ${SCHEMA}.site_settings where key in (${KEYS})`,
  );
  const method = sql(
    `select coalesce(row_to_json(m), 'null') from ${SCHEMA}.shipping_methods m where m.code = 'post'`,
  );
  const rules = sql(
    `select coalesce(json_agg(r), '[]') from ${SCHEMA}.shipping_rules r where method_id = (select id from ${SCHEMA}.shipping_methods where code = 'post')`,
  );
  return async () => {
    sql(`delete from ${SCHEMA}.site_settings where key in (${KEYS})`);
    const lit = (s) => `$j$${s}$j$`;
    sql(
      `insert into ${SCHEMA}.site_settings (key, value) select x->>'k', x->'v' from json_array_elements(${lit(settings)}::json) x`,
    );
    if (method !== 'null') {
      sql(
        `update ${SCHEMA}.shipping_methods set label = m.label, active = m.active from json_populate_record(null::${SCHEMA}.shipping_methods, ${lit(method)}::json) m where shipping_methods.code = 'post'`,
      );
      sql(
        `delete from ${SCHEMA}.shipping_rules where method_id = (select id from ${SCHEMA}.shipping_methods where code = 'post')`,
      );
      sql(
        `insert into ${SCHEMA}.shipping_rules overriding system value select * from json_populate_recordset(null::${SCHEMA}.shipping_rules, ${lit(rules)}::json)`,
      );
    }
    sql(`delete from ${SCHEMA}.secret_settings`);
    sql(`delete from ${SCHEMA}.geo_provinces where id in (9001, 9002, 9003)`);
    // the bot's endpoint drops the shop's settings cache, so the next test sees the restored values at once
    const secret = process.env.E2E_REVALIDATE_SECRET;
    if (secret)
      await fetch(`${BASE}/api/internal/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ paths: [{ path: '/shop' }] }),
      }).catch(() => {});
  };
}

/** the three test provinces, when Liateam's list was never fetched into the local database */
export function ensureProvinces() {
  sql(
    `insert into ${SCHEMA}.geo_provinces (id, name, fetched_at) values (9001, 'تهران آزمایشی', now()), (9002, 'البرز آزمایشی', now()), (9003, 'فارس آزمایشی', now()) on conflict (id) do nothing`,
  );
}
