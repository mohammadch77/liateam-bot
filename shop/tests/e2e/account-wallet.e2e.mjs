// The wallet (task F), end to end on the dev simulator gateway: charging (below the minimum, success, a repeated callback, backing
// out, online payment switched off, someone else's callback), withdrawals for affiliates only (a plain customer sees no form and the
// server refuses), the limits (minimum, the commission-only ceiling, the IBAN, one pending at a time), the hold in the ledger, the
// affiliate cancelling (twice from two tabs), the admin rejecting and paying, and what the pages show or hide. Invented numbers, new
// for every run; nothing leaves this machine.
import {
  BASE,
  SCHEMA as S,
  check,
  chromium,
  finish,
  requireLocalApp,
  signIn,
  sleep,
  sql,
  toLatin,
} from './_harness.mjs';
import { makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { chooseAtGateway, enablePayment, setSetting } from './_pay.mjs';
import { seeder } from './_seed-order.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09998', stamp);
const PHONES = `select phone from ${S}.users where phone like '09998%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const num = (t) => Number(toLatin(t));
const GOOD_IBAN = 'IR780600000000100324200001';

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
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'user' and entity_id in (select id::text from ${S}.users where phone in (${PHONES})));
    delete from ${S}.users where phone in (${PHONES});`);

const balance = (u) =>
  Number(
    sql(`select coalesce((select balance_after from ${S}.wallet_ledger where user_id = ${u.id} order by id desc limit 1), 0)`),
  );
const ledger = (u, kind) =>
  Number(sql(`select count(*) from ${S}.wallet_ledger where user_id = ${u.id} and kind = '${kind}'`));
const payments = (u) => Number(sql(`select count(*) from ${S}.payments where user_id = ${u.id} and kind = 'wallet_topup'`));
const confirmedTopups = (u) =>
  Number(sql(`select count(*) from ${S}.payments where user_id = ${u.id} and kind = 'wallet_topup' and status = 'confirmed'`));
const wd = (u) =>
  sql(`select coalesce(string_agg(status::text || ':' || amount, ',' order by id), '') from ${S}.withdrawals where user_id = ${u.id}`);
const sms = (p) => Number(sql(`select count(*) from ${S}.sms_log where phone = '${p}' and purpose = 'other' and status = 'sent'`));
const credit = (u, kind, amount, key) =>
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${u.id}, '${kind}', ${amount}, 0, '${key}-${stamp}')`,
  );

const restorePay = await enablePayment({
  'sms.provider': 'dev',
  'sms.event.topup_ok.enabled': true,
  'sms.event.topup_ok.template': 'topup-t',
  'sms.event.withdrawal_requested.enabled': true,
  'sms.event.withdrawal_requested.template': 'wd-req-t',
  'sms.event.withdrawal_paid.enabled': true,
  'sms.event.withdrawal_paid.template': 'wd-paid-t',
  'sms.event.withdrawal_rejected.enabled': true,
  'sms.event.withdrawal_rejected.template': 'wd-rej-t',
});
const browser = await chromium.launch();
const open = async (user) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, user.phone);
  return { ctx, page };
};
const topup = async (page, amount) => {
  await page.goto(`${BASE}/account/wallet`);
  await page.locator('[data-topup] input[name="amount"]').fill(String(amount));
  await page.locator('[data-topup-submit]').click();
};
const requestWd = async (page, amount, iban = GOOD_IBAN, holder = 'همکار آزمون') => {
  await page.goto(`${BASE}/account/wallet`);
  await page.locator('[data-withdraw] input[name="amount"]').fill(String(amount));
  await page.locator('[data-withdraw] input[name="holder"]').fill(holder);
  await page.locator('[data-withdraw] input[name="iban"]').fill(iban);
  await page.locator('[data-withdraw-submit]').click();
};
const alertText = async (page, scope) => {
  const box = page.locator(`${scope} [role="alert"]`).first();
  await box.waitFor({ timeout: 15000 });
  return box.innerText();
};

let adminCtx;
try {
  wipe();
  const cust = makeUser(1);
  const aff = makeUser(2);
  const other = makeUser(3);
  sql(`update ${S}.users set full_name = 'x' where id = ${cust.id}`);
  sql(`insert into ${S}.user_roles (user_id, role) values (${aff.id}, 'affiliate')`);
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${aff.id}, 'wal${stamp}')`);
  const { page: cp } = await open(cust);

  // ── 1. the page for a plain customer ──
  await cp.goto(`${BASE}/account/wallet`);
  check('1a a plain customer sees the charge form', (await cp.locator('[data-topup-submit]').isEnabled()));
  check(
    '1b no withdrawal form; «برداشت مخصوص همکاران فروش است» with a link to the affiliate page',
    (await cp.locator('[data-withdraw]').count()) === 0 &&
      (await cp.locator('[data-withdraw-locked]').innerText()).includes('برداشت مخصوص همکاران فروش است') &&
      (await cp.locator('[data-withdraw-locked] a').getAttribute('href')).startsWith('/affiliate'),
  );
  check('1c no «قابل برداشت» box for a customer', (await cp.locator('[data-wallet-withdrawable]').count()) === 0);
  const adminTry = await cp.goto(`${BASE}/admin/withdrawals`);
  check('1d /admin/withdrawals is refused for a customer', adminTry?.status() === 403, String(adminTry?.status()));

  // ── 2. charging ──
  await topup(cp, 10000);
  check('2a below the minimum: refused with the minimum, nothing started', (await alertText(cp, '[data-topup]')).includes('حداقل') && payments(cust) === 0);
  await cp.goto(`${BASE}/account/wallet`);
  await cp.locator('[data-topup-preset="100000"]').click();
  check('2b a quick amount fills the field', (await cp.locator('[data-topup] input[name="amount"]').inputValue()) === '100000');
  await cp.locator('[data-topup-submit]').click();
  await cp.waitForURL(/\/payment\/simulator/, { timeout: 40000 });
  check('2c the gateway page shows the amount saved in the database, for a wallet charge', num(await cp.locator('[data-sim-amount]').innerText()) === 100000 && (await cp.locator('body').innerText()).includes('شارژ کیف پول'));
  await chooseAtGateway(cp, 'success');
  const cbUrl = cp.url();
  check('2d success: the callback says paid, one ledger row «شارژ», the balance is the amount', (await cp.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'paid' && (await cp.locator('[data-topup-result]').count()) === 1 && ledger(cust, 'topup') === 1 && balance(cust) === 100000 && confirmedTopups(cust) === 1);
  check('2e one SMS for it', sms(cust.phone) === 1, String(sms(cust.phone)));
  await cp.goto(cbUrl);
  await cp.reload();
  check('2f the same return opened again: «repeat», credited once', (await cp.locator('[data-callback-repeat]').getAttribute('data-callback-repeat')) === 'true' && ledger(cust, 'topup') === 1 && balance(cust) === 100000 && sms(cust.phone) === 1);
  const o = await open(other);
  await o.page.goto(cbUrl);
  check("2g another user opening that return: «unknown», nothing credited", (await o.page.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'unknown' && balance(other) === 0);
  await topup(cp, 60000);
  await chooseAtGateway(cp, 'canceled');
  check('2h backing out: «canceled», no row, the balance as before', (await cp.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'canceled' && ledger(cust, 'topup') === 1 && balance(cust) === 100000);
  await topup(cp, 60000);
  await chooseAtGateway(cp, 'failed');
  check('2i a refused payment: «failed», nothing credited', (await cp.locator('[data-callback-result]').getAttribute('data-callback-result')) === 'failed' && balance(cust) === 100000);
  await cp.goto(`${BASE}/account/wallet`);
  check('2j the ledger lists the charge', (await cp.locator('[data-wallet-entry="topup"]').count()) === 1);
  await setSetting('payment.enabled', false);
  await cp.goto(`${BASE}/account/wallet`);
  check('2k online payment off: the charge button is disabled with a message', (await cp.locator('[data-topup-submit]').isDisabled()) && (await cp.locator('[data-topup]').innerText()).includes('در دسترس نیست'));
  await setSetting('payment.enabled', true);

  // ── 3. an affiliate: limits, hold, cancel ──
  const { page: ap } = await open(aff);
  credit(aff, 'commission', 500000, 'comm-a');
  await topup(ap, 100000);
  await chooseAtGateway(ap, 'success');
  await ap.goto(`${BASE}/account/wallet`);
  check('3a balance 600 000, withdrawable only the commission: 500 000, held 0', num(await ap.locator('[data-wallet-balance]').innerText()) === 600000 && num(await ap.locator('[data-wallet-withdrawable]').innerText()) === 500000 && num(await ap.locator('[data-wallet-held]').innerText()) === 0);
  await requestWd(ap, 150000);
  check('3b below the minimum (200 000): refused', (await alertText(ap, '[data-withdraw]')).includes('حداقل') && wd(aff) === '');
  await requestWd(ap, 600000);
  check('3c more than the withdrawable amount (charged money is not withdrawable): refused', (await alertText(ap, '[data-withdraw]')).includes('قابل برداشت') && wd(aff) === '' && balance(aff) === 600000);
  await requestWd(ap, 300000, 'IR780600000000100324200002');
  check('3d a wrong IBAN check digit: refused', (await alertText(ap, '[data-withdraw]')).includes('شبا') && wd(aff) === '');
  await requestWd(ap, 300000, 'IR12');
  check('3e a short IBAN: refused', wd(aff) === '');
  await requestWd(ap, 300000);
  await ap.waitForFunction(() => document.body.innerText.includes('درخواست برداشت ثبت شد'), null, { timeout: 15000 });
  check('3f accepted: pending, the amount held in the ledger at once (balance 300 000), one «withdrawal» row', wd(aff) === `pending:300000` && balance(aff) === 300000 && ledger(aff, 'withdrawal') === 1);
  await ap.goto(`${BASE}/account/wallet`);
  const html = await ap.content();
  check('3g held 300 000, withdrawable 200 000; the page shows the account masked and never whole', num(await ap.locator('[data-wallet-held]').innerText()) === 300000 && num(await ap.locator('[data-wallet-withdrawable]').innerText()) === 200000 && !html.includes(GOOD_IBAN) && html.includes('0001'));
  check('3h one SMS for the request', sms(aff.phone) === 2, String(sms(aff.phone))); // the top-up one + this
  await requestWd(ap, 200000);
  check('3i a second request while one is pending: refused', (await alertText(ap, '[data-withdraw]')).includes('در حال بررسی') && wd(aff) === 'pending:300000');
  await ap.goto(`${BASE}/account/wallet`);
  const tab2 = await ap.context().newPage();
  await tab2.goto(`${BASE}/account/wallet`);
  await ap.locator('[data-withdraw-cancel]').click();
  await tab2.locator('[data-withdraw-cancel]').click();
  await Promise.all([
    ap.locator('[data-confirm-dialog="withdraw-cancel"] [data-confirm-yes]').click(),
    tab2.locator('[data-confirm-dialog="withdraw-cancel"] [data-confirm-yes]').click(),
  ]);
  await sleep(2500);
  check('3j cancelled from two tabs at once: one return row, the balance back to 600 000', wd(aff) === 'canceled:300000' && ledger(aff, 'withdrawal_return') === 1 && balance(aff) === 600000, `${wd(aff)} ${ledger(aff, 'withdrawal_return')} ${balance(aff)}`);
  await tab2.close();

  // ── 4. the admin: reject (returns) and pay (stays) ──
  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adm = await adminCtx.newPage();
  await adminSignIn(adm, adminPhone, '/admin');
  await requestWd(ap, 250000);
  await ap.waitForFunction(() => document.body.innerText.includes('درخواست برداشت ثبت شد'), null, { timeout: 15000 });
  await adm.goto(`${BASE}/admin`);
  check('4a «نیازمند توجه» counts the pending request', (await adm.locator('[data-attention-withdrawals]').count()) === 1);
  await adm.goto(`${BASE}/admin/withdrawals`);
  const idA = sql(`select id from ${S}.withdrawals where user_id = ${aff.id} and status = 'pending'`);
  check('4b the admin sees the whole IBAN and the holder', (await adm.locator(`[data-withdrawal-id="${idA}"] [data-iban]`).innerText()).replace(/\s/g, '') === GOOD_IBAN);
  await adm.locator(`[data-withdrawal-id="${idA}"] input[name="reason"]`).fill('حساب نامعتبر');
  await adm.locator(`[data-withdrawal-id="${idA}"] [data-wd-reject]`).click();
  await adm.waitForURL(/done=rejected/, { timeout: 15000 });
  check('4c rejected: the whole amount is back, one return row, the reason kept, an SMS', wd(aff) === 'canceled:300000,rejected:250000' && balance(aff) === 600000 && ledger(aff, 'withdrawal_return') === 2 && sql(`select reject_reason from ${S}.withdrawals where id = ${idA}`) === 'حساب نامعتبر');
  await adm.goto(`${BASE}/admin/withdrawals?status=pending`);
  check('4d a decided request is not offered again', (await adm.locator(`[data-withdrawal-id="${idA}"]`).count()) === 0);
  await requestWd(ap, 250000);
  await ap.waitForFunction(() => document.body.innerText.includes('درخواست برداشت ثبت شد'), null, { timeout: 15000 });
  const idB = sql(`select id from ${S}.withdrawals where user_id = ${aff.id} and status = 'pending'`);
  await adm.goto(`${BASE}/admin/withdrawals?status=pending`);
  await adm.locator(`[data-withdrawal-id="${idB}"] [data-wd-paid]`).click();
  await adm.waitForURL(/error=|done=/, { timeout: 15000 });
  check('4e «پرداخت شد» without a tracking code is refused', (await adm.locator('main [role="alert"]').first().innerText()).includes('کد پیگیری') && wd(aff).endsWith('pending:250000'));
  await adm.goto(`${BASE}/admin/withdrawals?status=pending`);
  await adm.locator(`[data-withdrawal-id="${idB}"] input[name="ref"]`).fill('BANK123456');
  await adm.locator(`[data-withdrawal-id="${idB}"] [data-wd-paid]`).click();
  await adm.waitForURL(/done=paid/, { timeout: 15000 });
  check('4f paid: status paid with the tracking code, the money stays out (balance 350 000), no extra return', wd(aff).endsWith('paid:250000') && balance(aff) === 350000 && ledger(aff, 'withdrawal_return') === 2 && sql(`select paid_ref from ${S}.withdrawals where id = ${idB}`) === 'BANK123456');
  await ap.goto(`${BASE}/account/wallet`);
  check('4g the affiliate sees «پرداخت شد» with the code; no cancel button on a paid one; the paid amount no longer counts as withdrawable', toLatin(await ap.locator('[data-withdrawal="paid"]').innerText()).includes('123456') && (await ap.locator('[data-withdraw-cancel]').count()) === 0 && num(await ap.locator('[data-wallet-withdrawable]').innerText()) === 250000);
  check('4h SMS for the reject and the payment (requested ×3, rejected, paid, top-ups included)', sms(aff.phone) >= 6, String(sms(aff.phone)));
  await ap.reload();
  check('4i the ledger shows the withdrawal and the returns', (await ap.locator('[data-wallet-entry="withdrawal"]').count()) >= 1 && (await ap.locator('[data-wallet-entry="withdrawal_return"]').count()) >= 1);

  // ── 5. the server checks the role itself; others see nothing ──
  await ap.goto(`${BASE}/account/wallet`);
  sql(`delete from ${S}.user_roles where user_id = ${aff.id} and role = 'affiliate'`);
  await ap.locator('[data-withdraw] input[name="amount"]').fill('200000');
  await ap.locator('[data-withdraw] input[name="holder"]').fill('همکار آزمون');
  await ap.locator('[data-withdraw] input[name="iban"]').fill(GOOD_IBAN);
  await ap.locator('[data-withdraw-submit]').click();
  check('5a the form was open but the role was removed: the server refuses («مخصوص همکاران فروش است»), nothing held', (await alertText(ap, '[data-withdraw]')).includes('مخصوص همکاران فروش') && balance(aff) === 350000);
  await o.page.goto(`${BASE}/account/wallet`);
  check("5b another user's wallet shows none of these requests or entries", (await o.page.locator('[data-withdrawal]').count()) === 0 && (await o.page.locator('[data-wallet-entry]').count()) === 0);

  // ── 6. the setting that changes the ceiling ──
  sql(`insert into ${S}.user_roles (user_id, role) values (${aff.id}, 'affiliate')`);
  await setSetting('withdrawal.source', 'balance');
  await ap.goto(`${BASE}/account/wallet`);
  check('6a «از کل موجودی»: the whole balance is withdrawable', num(await ap.locator('[data-wallet-withdrawable]').innerText()) === 350000);
  await setSetting('withdrawal.source', 'commission');
  await setSetting('withdrawal.min', 300000);
  await requestWd(ap, 250000);
  check('6b the minimum is a setting: 250 000 is refused once it is 300 000', (await alertText(ap, '[data-withdraw]')).includes('حداقل') && !wd(aff).includes('pending'));
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
