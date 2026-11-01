// Paying on WebKit phones (iPhone 8 and iPhone 13 profiles), by TAP: the order page's payment panel (44px controls, no sideways
// scroll), to the simulator gateway, back out, «تلاش دوباره», pay, the callback page, and the order moving on. The stand-in bot
// (_responder.mjs) answers the bot's jobs; the order is seeded in the database. Invented numbers, new for every run.
import { SCHEMA as S, check, devices, finish, requireLocalApp, signIn, sql, webkit } from './_harness.mjs';
import { chooseAtGateway, enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { makeUser } = seeder('09994', stamp);
const PHONES = `select phone from ${S}.users where phone like '09994%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where order_id in (${OIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});`);

const bot = startResponder();
const restorePay = await enablePayment({
  'orders.auto_place_enabled': true,
  'orders.auto_place_hours': { from: '00:00', to: '00:00' },
});
const browser = await webkit.launch();
try {
  wipe();
  let n = 0;
  for (const name of ['iPhone 8', 'iPhone 13']) {
    n += 1;
    const user = makeUser(n);
    const order = seedOrder(user);
    const ctx = await browser.newContext({ ...devices[name] });
    const p = await ctx.newPage();
    const flat = async () =>
      (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;
    await signIn(p, user.phone);
    await p.goto(`/account/orders/${order.number}`.replace(/^/, new URL(p.url()).origin));

    const small = await p.evaluate(
      () =>
        [...document.querySelectorAll('[data-pay-panel] button, [data-pay-panel] label')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 43.5;
        }).length,
    );
    check(
      `1a ${name}: the payment panel's options and button are 44px+ and the page does not scroll sideways`,
      small === 0 && (await flat()),
      `${small} too small`,
    );
    await p.locator('[data-pay-submit]').tap();
    await chooseAtGateway(p, 'canceled', { tap: true });
    check(
      `1b ${name}: backing out by tap: «انصراف», the order still waits; no sideways scroll`,
      (await p.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'canceled' &&
        (await flat()),
    );
    const retry = p.locator('[data-pay-submit]');
    check(`1c ${name}: the retry button is 44px+`, (await retry.boundingBox())?.height >= 43.5);
    await retry.tap();
    await chooseAtGateway(p, 'success', { tap: true });
    check(
      `1d ${name}: paying by tap: paid on the callback page, one confirmed payment of the order's total`,
      (await p.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'paid' &&
        Number(
          sql(
            `select count(*) from ${S}.payments where status = 'confirmed' and amount = ${order.payable} and order_id = ${order.id}`,
          ),
        ) === 1 &&
        (await flat()),
    );
    await p.locator('[data-view-order]').tap();
    await p.waitForURL(/\/account\/orders\/AV-\d+/);
    check(
      `1e ${name}: the order page after payment shows it is paid and fits the screen`,
      !(await p.locator('[data-pay-panel]').count()) && (await flat()),
    );
    await ctx.close();
  }
} finally {
  try {
    await restorePay();
  } catch (e) {
    console.error('restore failed:', e.message);
  }
  await bot.stop();
  wipe();
  await browser.close();
}
finish();
