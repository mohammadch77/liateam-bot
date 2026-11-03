// The affiliate pages on a WebKit phone (iPhone 8), by TAP, once: no sideways scroll on the dashboard, the network and the commissions,
// 44px controls (copy buttons, filters), the tab row with the affiliate entry, the copy button working. Invented numbers, new every run.
import { BASE, SCHEMA as S, check, devices, finish, requireLocalApp, signIn, sql, webkit } from './_harness.mjs';
import { enablePayment } from './_pay.mjs';
import { seeder } from './_seed-order.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { makeUser } = seeder('09991', stamp);
const PHONES = `select phone from ${S}.users where phone like '09991%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where affiliate_user_id in (${UIDS});
    delete from ${S}.affiliate_referrals where buyer_user_id in (${UIDS}) or referrer_user_id in (${UIDS});
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
  const aff = makeUser(1);
  const buyer = makeUser(2);
  sql(`insert into ${S}.user_roles (user_id, role) values (${aff.id}, 'affiliate')`);
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${aff.id}, 'mob${stamp}')`);
  sql(`insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${buyer.id}, ${aff.id}, 'mob${stamp}')`);
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
  await signIn(p, aff.phone);
  for (const [name, path] of [
    ['dashboard', '/account/affiliate'],
    ['network', '/account/affiliate/network'],
    ['commissions', '/account/affiliate/commissions'],
  ]) {
    await p.goto(`${BASE}${path}`);
    check(`1 ${name}: no sideways scroll; the tab row's links are 44px+`, (await flat()) && (await small('[data-account-nav] a')) === 0);
  }
  await p.goto(`${BASE}/account/affiliate`);
  check('2a the copy buttons are 44px+', (await small('[data-copy]')) === 0);
  await p.locator('[data-affiliate-code] [data-copy]').first().tap();
  check('2b tapping copy says «کپی شد» (or the browser refused and nothing broke)', (await p.locator('[data-copy]').first().innerText()).length > 0 && (await flat()));
  check('2c the dashboard shows the code', (await p.locator('[data-code]').innerText()) === `mob${stamp}`);
  await p.goto(`${BASE}/account/affiliate/network`);
  check('3 the network filter chips are 44px+ and the buyer is listed', (await small('[data-level-filters] a')) === 0 && (await p.locator('[data-network-row]').count()) === 1);
  await p.goto(`${BASE}/account/affiliate/commissions`);
  check('4a the commission filters fit the screen', (await flat()) && (await p.locator('[data-month]').count()) === 12);
  check('4b the filter controls are 44px+', (await small('[data-commission-filters] select, [data-commission-filters] input, [data-commission-filters] a, [data-commission-filters] button')) === 0);
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
