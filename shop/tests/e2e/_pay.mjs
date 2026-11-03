// Helpers for the tests that go through the payment: switch the online payment on with the dev simulator (and put the settings
// back), set a setting, and walk the simulator gateway as a customer. Local app and Docker database only.
import { BASE, SCHEMA as S, sql, sleep } from './_harness.mjs';

const KEYS = [
  'payment.enabled',
  'payment.provider',
  'payment.sandbox',
  'site.base_url',
  'sms.provider',
  'sms.event.order_placed.enabled',
  'sms.event.order_placed.template',
  'sms.event.payment_ok.enabled',
  'sms.event.payment_ok.template',
  'sms.event.needs_review.enabled',
  'sms.event.needs_review.template',
  'sms.event.shipped.enabled',
  'sms.event.shipped.template',
  'sms.event.canceled.enabled',
  'sms.event.canceled.template',
  'orders.auto_place_enabled',
  'orders.auto_place_hours',
  'orders.price_tolerance_toman',
  'orders.stuck_alert_minutes',
  'orders.operator_phone',
  'orders.customer_cancel_enabled',
  'wallet.topup_min',
  'wallet.topup_max',
  'withdrawal.min',
  'withdrawal.max',
  'withdrawal.single_pending',
  'withdrawal.source',
  'sms.event.topup_ok.enabled',
  'sms.event.topup_ok.template',
  'sms.event.withdrawal_requested.enabled',
  'sms.event.withdrawal_requested.template',
  'sms.event.withdrawal_paid.enabled',
  'sms.event.withdrawal_paid.template',
  'sms.event.withdrawal_rejected.enabled',
  'sms.event.withdrawal_rejected.template',
  'sms.event.commission_paid.enabled',
  'sms.event.commission_paid.template',
  'sms.operator_template',
  'sms.event.cancel_rejected.enabled',
  'sms.event.cancel_rejected.template',
  'orders.payment_link_ttl_minutes',
  'orders.payment_link_remind_minutes',
];
const lit = (v) => `$j$${JSON.stringify(v)}$j$::jsonb`;

/** the bot's endpoint: drops the shop's settings cache at once */
export async function dropCaches() {
  const secret = process.env.E2E_REVALIDATE_SECRET;
  if (!secret) {
    await sleep(1200);
    return;
  }
  await fetch(`${BASE}/api/internal/revalidate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
    body: JSON.stringify({ paths: [{ path: '/shop' }] }),
  }).catch(() => {});
}

export async function setSetting(key, value) {
  sql(
    `insert into ${S}.site_settings (key, value) values ('${key}', ${lit(value)}) on conflict (key) do update set value = excluded.value`,
  );
  await dropCaches();
}

/**
 * Online payment on, through the dev simulator, with the site address of this run. Returns the function that puts every setting
 * these tests may touch back as it was.
 */
export async function enablePayment(extra = {}) {
  const keys = KEYS.map((k) => `'${k}'`).join(',');
  const before = sql(
    `select coalesce(json_agg(json_build_object('k', key, 'v', value)), '[]') from ${S}.site_settings where key in (${keys})`,
  );
  const base = {
    'payment.enabled': true,
    'payment.provider': 'dev',
    'payment.sandbox': true,
    'site.base_url': BASE,
    ...extra,
  };
  for (const [k, v] of Object.entries(base))
    sql(
      `insert into ${S}.site_settings (key, value) values ('${k}', ${lit(v)}) on conflict (key) do update set value = excluded.value`,
    );
  await dropCaches();
  return async () => {
    sql(`delete from ${S}.site_settings where key in (${keys})`);
    sql(
      `insert into ${S}.site_settings (key, value) select x->>'k', x->'v' from json_array_elements($j$${before}$j$::json) x`,
    );
    await dropCaches();
  };
}

/** On the simulator gateway page: choose success | failed | canceled (it returns to the callback page). */
export async function chooseAtGateway(page, outcome, { tap = false } = {}) {
  await page.waitForURL(/\/payment\/simulator/, { timeout: 40000 });
  const button = page.locator(`[data-sim="${outcome}"]`);
  if (tap) await button.tap();
  else await button.click();
  await page.waitForURL(/\/payment\/callback/, { timeout: 40000 });
}

/** Back out at the gateway and open the order (it stays pending_payment). */
export async function cancelAtGateway(page, opts = {}) {
  await chooseAtGateway(page, 'canceled', opts);
  const view = page.locator('[data-view-order]');
  if (opts.tap) await view.tap();
  else await view.click();
  await page.waitForURL(/\/account\/orders\/AV-\d+/, { timeout: 40000 });
}
