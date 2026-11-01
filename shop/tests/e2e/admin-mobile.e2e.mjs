// The settings screen on WebKit phones (iPhone 8 and iPhone 13 profiles), by TAP: the section tabs scroll inside their own
// strip (the page never scrolls sideways), every control is 44px, a setting is saved by tapping, a secret is written and
// shown masked, the shipping ranges are edited and applied in bulk. Needs the app running locally like admin.e2e.mjs.
import { SCHEMA as S, check, devices, finish, requireLocalApp, sql, webkit } from './_harness.mjs';
import { NET, RUN, ensureProvinces, makeAdmin, signIn, snapshotSettings } from './_admin-login.mjs';

requireLocalApp();
if (Number(sql(`select count(*) from ${S}.secret_settings`)) > 0) {
  console.error(
    'secret_settings is not empty in the local database; this test replaces its rows. Empty it first.',
  );
  process.exit(2);
}
const restore = snapshotSettings();
ensureProvinces();
sql(
  `delete from ${S}.shipping_rules where method_id = (select id from ${S}.shipping_methods where code = 'post')`,
);
const setting = (key) => sql(`select value::text from ${S}.site_settings where key = '${key}'`);
const SECRET = `mk-${RUN}-Qw7Er5Ty8812`;

const browser = await webkit.launch();
try {
  let n = 0;
  for (const name of ['iPhone 8', 'iPhone 13']) {
    n += 1;
    const phone = `0914${RUN}${n}`;
    makeAdmin(phone);
    const ctx = await browser.newContext({
      ...devices[name],
      extraHTTPHeaders: { 'x-real-ip': `10.${NET}.${10 + n}.1` },
    });
    const p = await ctx.newPage();
    const flat = async () =>
      (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;
    await signIn(p, phone, '/admin/settings');

    // ── tabs ──
    const tabs = await p.evaluate(() => {
      const nav = document.querySelector('[data-settings-tabs]');
      const links = [...nav.querySelectorAll('a')];
      return {
        scrolls: nav.scrollWidth > nav.clientWidth,
        count: links.length,
        minH: Math.min(...links.map((a) => a.getBoundingClientRect().height)),
      };
    });
    check(
      `1a ${name}: six tabs in a strip that scrolls inside itself, each 44px tall, and the page does not scroll sideways`,
      tabs.count === 6 && tabs.scrolls && tabs.minH >= 43.5 && (await flat()),
      JSON.stringify(tabs),
    );

    // ── a switch saved by tap ──
    await p.locator('[data-settings-tabs] [data-section="orders"]').tap();
    await p.waitForURL(/section=orders/);
    const small = await p.evaluate(
      () =>
        [
          ...document.querySelectorAll(
            '[data-settings-form] input:not([type=hidden]):not([type=radio]):not([type=checkbox]), [data-settings-form] button, [data-settings-form] label',
          ),
        ]
          .filter((e) => e.tagName !== 'LABEL' || e.querySelector('input'))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.height < 43.5;
          }).length,
    );
    check(
      `2a ${name}: every field and button of the orders section is at least 44px high; no sideways scroll`,
      small === 0 && (await flat()),
      `${small} too small`,
    );
    const form = p.locator('[data-settings-form="orders"]');
    const was = setting('orders.auto_place_enabled');
    await form.locator('label', { hasText: 'ثبت خودکار سفارش' }).tap();
    await form.locator('[name="orders.price_tolerance_toman"]').fill('۲۵۰');
    await form.getByRole('button', { name: 'ذخیره' }).tap();
    await p.waitForURL(/done=1/);
    check(
      `2b ${name}: the switch and the number are saved by tap`,
      setting('orders.auto_place_enabled') === (was === 'true' ? 'false' : 'true') &&
        setting('orders.price_tolerance_toman') === '250' &&
        (await p.locator('[role=status]').count()) >= 1,
    );
    const hours = await p.locator('[name="orders.auto_place_hours.from"]').getAttribute('type');
    check(`2c ${name}: working hours use the phone's time picker`, hours === 'time');

    // ── a secret ──
    await p.locator('[data-settings-tabs] [data-section="sms"]').tap();
    await p.waitForURL(/section=sms/);
    const sec = p.locator('[data-secret="sms.api_key"]');
    await sec.locator('input[name=value]').fill(SECRET);
    await sec.getByRole('button', { name: /ذخیره|تعویض/ }).tap();
    await p.waitForURL(/secret=1/);
    const html = await p.content();
    check(
      `3a ${name}: the secret is saved by tap and shown only masked`,
      (await p.locator('[data-secret-state]').first().innerText()).includes('••••' + SECRET.slice(-4)) &&
        !html.includes(SECRET),
      '',
    );
    check(`3b ${name}: the secret card fits the screen`, await flat());

    // ── shipping ──
    await p.locator('[data-settings-tabs] [data-section="shipping"]').tap();
    await p.waitForURL(/section=shipping/);
    await p.locator('[data-province]').first().waitFor();
    const ship = await p.evaluate(() => {
      const f = document.querySelector('[data-shipping-form]');
      const inputs = [...f.querySelectorAll('input[name$=".min"], input[name$=".max"], input[name=label]')];
      const checks = [...f.querySelectorAll('.provName, label')].filter((l) =>
        l.querySelector('input[type=checkbox]'),
      );
      return {
        inputsH: Math.min(...inputs.map((i) => i.getBoundingClientRect().height)),
        checksH: Math.min(...checks.map((i) => i.getBoundingClientRect().height)),
        outside: [...f.querySelectorAll('input')].filter((i) => {
          const r = i.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
        }).length,
      };
    });
    check(
      `4a ${name}: shipping inputs and tick rows are 44px, nothing leaves the screen`,
      ship.inputsH >= 43.5 && ship.checksH >= 43.5 && ship.outside === 0 && (await flat()),
      JSON.stringify(ship),
    );
    await p.locator('[data-select-all]').tap();
    const ticked = await p.locator('[data-province] input[name=sel]:checked').count();
    check(
      `4b ${name}: «انتخاب همه» ticks every province`,
      ticked === (await p.locator('[data-province]').count()) && ticked >= 3,
    );
    await p.locator('[name="bulk.min"]').fill('2');
    await p.locator('[name="bulk.max"]').fill('5');
    await p.locator('[data-bulk-apply]').tap();
    await p.waitForURL(/shipped=1/);
    const all = sql(
      `select count(*) filter (where eta_min_days = 2 and eta_max_days = 5 and active) || '/' || count(*) from ${S}.shipping_rules where province_id is not null and method_id = (select id from ${S}.shipping_methods where code = 'post')`,
    );
    const total = await p.locator('[data-province]').count();
    check(
      `4c ${name}: bulk by tap sets 2–5 days on all ${total} provinces`,
      all === `${total}/${total}`,
      all,
    );
    await ctx.close();
  }
} finally {
  try {
    await restore();
  } catch (e) {
    console.error('restore failed:', e.message);
  }
  await browser.close();
}
finish();
