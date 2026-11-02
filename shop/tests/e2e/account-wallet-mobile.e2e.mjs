// The wallet page on a WebKit phone (iPhone 8), by TAP, once: no sideways scroll, 44px controls, a charge by tap through the
// simulator gateway, the affiliate's withdrawal form and its cancel dialog fitting the screen. Invented numbers, new every run.
import { BASE, SCHEMA as S, check, devices, finish, requireLocalApp, signIn, sql, webkit } from './_harness.mjs';
import { chooseAtGateway, enablePayment } from './_pay.mjs';
import { seeder } from './_seed-order.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { makeUser } = seeder('09999', stamp);
const PHONES = `select phone from ${S}.users where phone like '09999%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.withdrawals where user_id in (${UIDS});
    delete from ${S}.payments where user_id in (${UIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.affiliate_codes where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});`);

const restorePay = await enablePayment({});
const browser = await webkit.launch();
try {
  wipe();
  const user = makeUser(1);
  sql(`insert into ${S}.user_roles (user_id, role) values (${user.id}, 'affiliate')`);
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${user.id}, 'wm${stamp}')`);
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${user.id}, 'commission', 500000, 0, 'comm-m-${stamp}')`,
  );
  const ctx = await browser.newContext({ ...devices['iPhone 8'] });
  const p = await ctx.newPage();
  const flat = async () => (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;
  const small = (sel) =>
    p.evaluate(
      (s) =>
        [...document.querySelectorAll(s)].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 43.5;
        }).length,
      sel,
    );
  await signIn(p, user.phone);
  await p.goto(`${BASE}/account/wallet`);
  check('1a the wallet page does not scroll sideways', await flat());
  check('1b the charge presets, field and button are 44px+', (await small('[data-topup] button, [data-topup] input')) === 0);
  await p.locator('[data-topup-preset="100000"]').tap();
  await p.locator('[data-topup-submit]').tap();
  await chooseAtGateway(p, 'success', { tap: true });
  check(
    '1c charged by tap: paid on the callback page, one confirmed top-up, the page fits',
    (await p.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'paid' &&
      Number(sql(`select count(*) from ${S}.payments where user_id = ${user.id} and kind = 'wallet_topup' and status = 'confirmed'`)) === 1 &&
      (await flat()),
  );
  await p.goto(`${BASE}/account/wallet`);
  check('2a the withdrawal form: fields and button are 44px+, no sideways scroll', (await small('[data-withdraw] input, [data-withdraw] button')) === 0 && (await flat()));
  await p.locator('[data-withdraw] input[name="amount"]').fill('300000');
  await p.locator('[data-withdraw] input[name="holder"]').fill('Test Holder');
  await p.locator('[data-withdraw] input[name="iban"]').fill('IR780600000000100324200001');
  await p.locator('[data-withdraw-submit]').tap();
  await p.waitForFunction(() => document.body.innerText.includes('درخواست برداشت ثبت شد'), null, { timeout: 20000 });
  check('2b accepted by tap: pending, held', sql(`select status::text || ':' || amount from ${S}.withdrawals where user_id = ${user.id}`) === 'pending:300000');
  await p.goto(`${BASE}/account/wallet`);
  await p.locator('[data-withdraw-cancel]').tap();
  const box = await p.locator('[data-confirm-dialog="withdraw-cancel"]').boundingBox();
  const vp = p.viewportSize();
  check('2c the cancel dialog fits the screen and its buttons are 44px+', !!box && box.x >= 0 && box.x + box.width <= vp.width + 1 && (await small('[data-confirm-dialog="withdraw-cancel"] button')) === 0);
  await p.locator('[data-confirm-dialog="withdraw-cancel"] [data-confirm-yes]').tap();
  await p.waitForFunction(() => document.querySelector('[data-withdrawal="canceled"]'), null, { timeout: 20000 });
  check('2d cancelled by tap: the money is back', sql(`select status::text from ${S}.withdrawals where user_id = ${user.id}`) === 'canceled' && (await flat()));
  await ctx.close();
} finally {
  try {
    await restorePay();
  } catch (e) {
    console.error('restore failed:', e.message);
  }
  wipe();
  await browser.close();
}
finish();
