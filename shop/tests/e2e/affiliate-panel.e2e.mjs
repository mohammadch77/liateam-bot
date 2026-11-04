// The sales affiliate (task G, one level since task K), end to end: the referral link and first sign-up, an order sent, the hold, the
// worker's tick paying automatic commissions into the wallet (once, even from two ticks at once), a manual-approval rule that waits for
// the admin, a cancelled order that pays nothing, the affiliate pages (code, network with its privacy limits, commissions, the twelve months,
// the CSV) and who may see what. Invented numbers, new for every run; nothing leaves this machine.
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
import { NET, makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const CRON = process.env.E2E_CRON_SECRET;
if (!CRON) {
  console.error('set E2E_CRON_SECRET to the CRON_SECRET the app was started with');
  process.exit(2);
}
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09992', stamp);
const PHONES = `select phone from ${S}.users where phone like '09992%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const num = (t) => Number(toLatin(t));

if (Number(sql(`select count(*) from ${S}.commission_rules`)) > 0) {
  console.error('commission_rules is not empty in the local database; this test replaces its rows. Empty it first.');
  process.exit(2);
}
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.withdrawals where user_id in (${UIDS});
    delete from ${S}.commissions where order_id in (${OIDS}) or affiliate_user_id in (${UIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.affiliate_referrals where buyer_user_id in (${UIDS}) or referrer_user_id in (${UIDS});
    delete from ${S}.affiliate_codes where user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'user' and entity_id in (select id::text from ${S}.users where phone in (${PHONES})));
    delete from ${S}.users where phone in (${PHONES});
    delete from ${S}.commission_rules;`);

const row = (n) =>
  sql(`select status || '|' || coalesce(bot_order_id::text, '') from ${S}.orders where number = '${n}'`).split('|');
const coms = (n) =>
  sql(
    `select coalesce(string_agg(level || ':' || status::text || ':' || amount, ',' order by level), '') from ${S}.commissions where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const balance = (u) =>
  Number(sql(`select coalesce((select balance_after from ${S}.wallet_ledger where user_id = ${u.id} order by id desc limit 1), 0)`));
const credits = (u) =>
  Number(sql(`select count(*) from ${S}.wallet_ledger where user_id = ${u.id} and kind = 'commission'`));
const smsPaid = (u) =>
  Number(sql(`select count(*) from ${S}.sms_log where phone = '${u.phone}' and purpose = 'other' and status = 'sent'`));
const tick = async () => {
  for (let i = 0; ; i++) {
    try {
      // a fresh connection each time: a kept-alive one the server already closed would be reset
      return await fetch(`${BASE}/api/internal/tick`, { method: 'POST', headers: { 'x-cron-secret': CRON, connection: 'close' } }).then((r) => r.json());
    } catch (e) {
      if (i >= 2) throw e;
      await sleep(500);
    }
  }
};

const bot = startResponder();
const restorePay = await enablePayment({
  'orders.auto_place_enabled': false,
  'sms.provider': 'dev',
  'sms.event.commission_paid.enabled': true,
  'sms.event.commission_paid.template': 'commission-t',
  'withdrawal.min': 1000,
});
const browser = await chromium.launch();
let ipn = 0;
/** every browser context gets its own client address (the sign-in quota is per address and per hour) */
const newCtx = () =>
  browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-real-ip': `10.${NET}.${60 + ++ipn}.1` } });
const open = async (user) => {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await adminSignIn(page, user.phone, '/'); // clears the old codes first: the same number signs in more than once here
  return { ctx, page };
};
/** an order paid from the wallet through the real page, then sent by the (stand-in) bot and followed by the shop */
async function sentOrder(page, buyer) {
  const o = seedOrder(buyer);
  await page.goto(`${BASE}/account/orders/${o.number}`);
  await page.locator('[data-pay-option="wallet"] input').check();
  await page.locator('[data-pay-submit]').click();
  await page.waitForURL(/paid=1/, { timeout: 40000 });
  return o;
}
async function sendIt(page, o) {
  const botId = row(o.number)[1];
  sql(`update public.shop_orders set status = 'sent', sent_at = now(), tracking = '{"code": "R-777"}'::jsonb where id = ${botId}`);
  const until = Date.now() + 20000;
  while (Date.now() < until && row(o.number)[0] !== 'sent') {
    await page.goto(`${BASE}/account/orders/${o.number}`);
    await sleep(500);
  }
  return row(o.number)[0] === 'sent';
}

try {
  wipe();
  const A = makeUser(1); // another affiliate (the sign-ups of section 1 come through A's link)
  const B = makeUser(2); // the buyer C's referrer
  const C = makeUser(3); // the buyer
  const X = makeUser(4); // a plain customer
  for (const u of [A, B]) {
    sql(`insert into ${S}.user_roles (user_id, role) values (${u.id}, 'affiliate')`);
  }
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${B.id}, 'bb${stamp}x')`);
  sql(`insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${C.id}, ${B.id}, 'bb${stamp}x')`);
  sql(`insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active, manual_approval) values
       ('l1', 'percent', 5, 'all', 1, 0, true, false)`);
  sql(
    `set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${C.id}, 'topup', 30000000, 0, 'seed-g-${stamp}')`,
  );
  const { page: cp } = await open(C);

  // ── 1. the referral link and a first sign-up ──
  const lctx = await newCtx();
  const lp = await lctx.newPage();
  const codeA = `ref${stamp}`;
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${A.id}, '${codeA}')`);
  const bad = await lp.goto(`${BASE}/r/zzzzzzzz`);
  const cookiesBad = (await lctx.cookies()).filter((c) => /ref/.test(c.name));
  check('1a an unknown code: goes home, sets no cookie (the link does not reveal what exists)', bad?.ok() === true && cookiesBad.length === 0);
  await lp.goto(`${BASE}/r/${codeA}`);
  check('1b a real code: remembered in a cookie, the visitor lands on the home page', (await lctx.cookies()).some((c) => /ref/.test(c.name) && c.value === codeA) && new URL(lp.url()).pathname === '/');
  const D = { phone: phone(7) };
  await signIn(lp, D.phone);
  const dRef = sql(`select referrer_user_id from ${S}.affiliate_referrals where buyer_user_id = (select id from ${S}.users where phone = '${D.phone}')`);
  check('1c the first sign-up through the link is attached to the referrer', dRef === A.id, dRef);
  check('1d the cookie is cleared once used', !(await lctx.cookies()).some((c) => /ref/.test(c.name) && c.value));
  // an existing account (X) following a link is not poached; nobody refers themselves; the referrer never changes
  const xctx = await newCtx();
  const xp = await xctx.newPage();
  await xp.goto(`${BASE}/r/${codeA}`);
  await signIn(xp, X.phone);
  check('1e an account that already existed is not attached by a later link', sql(`select count(*) from ${S}.affiliate_referrals where buyer_user_id = ${X.id}`) === '0');
  const selfCtx = await newCtx();
  const sp2 = await selfCtx.newPage();
  await sp2.goto(`${BASE}/r/${codeA}`);
  await signIn(sp2, A.phone);
  check('1f the owner of a code following it does not become their own referrer', sql(`select count(*) from ${S}.affiliate_referrals where buyer_user_id = ${A.id} and referrer_user_id = ${A.id}`) === '0');
  const E = { phone: phone(6) };
  const ectx = await newCtx();
  const ep = await ectx.newPage();
  await ep.goto(`${BASE}/r/${codeA}`);
  await signIn(ep, E.phone);
  await ep.context().clearCookies();
  await ep.goto(`${BASE}/r/bb${stamp}x`); // a second link, then a sign-in of the same (now existing) user
  await adminSignIn(ep, E.phone, "/");
  check('1g the referrer of a signed-up user is fixed: a later link and sign-in do not change it', sql(`select referrer_user_id from ${S}.affiliate_referrals where buyer_user_id = (select id from ${S}.users where phone = '${E.phone}')`) === A.id);

  // ── 2. a two-level order: sent, the hold, the worker pays ──
  const o1 = await sentOrder(cp, C);
  const goods = Number(sql(`select items_total from ${S}.orders where number = '${o1.number}'`));
  const c1 = Math.floor((goods * 5) / 100);
  check('2a paid: one level only, 5% (automatic), pending, with the rule\'s percent kept on the row', coms(o1.number) === `1:pending:${c1}` && sql(`select rule_kind || ':' || rule_value::float8 from ${S}.commissions where order_id = ${o1.id}`) === 'percent:5', coms(o1.number));
  await tick();
  check('2b before the order is sent the worker pays nothing', credits(B) === 0);
  check('2c the order is sent (the shop followed the bot)', await sendIt(cp, o1));
  sql(`update ${S}.commissions set release_at = now() + interval '1 day' where order_id = (select id from ${S}.orders where number = '${o1.number}')`);
  await tick();
  check('2d sent but the hold has not passed: still pending, nothing credited', coms(o1.number) === `1:pending:${c1}` && credits(B) === 0);
  sql(`update ${S}.commissions set release_at = now() - interval '1 minute' where order_id = (select id from ${S}.orders where number = '${o1.number}')`);
  await Promise.all([tick(), tick()]);
  await tick();
  check('2e the hold has passed: the automatic one is paid into the wallet — ONCE, though two ticks ran together and a third followed', coms(o1.number) === `1:paid:${c1}` && credits(B) === 1 && balance(B) === c1, `${coms(o1.number)} ${credits(B)} ${balance(B)}`);
  check('2f the ledger row has the commission as its key; the commission points at it', sql(`select count(*) from ${S}.wallet_ledger l join ${S}.commissions c on c.wallet_entry_id = l.id where l.idempotency_key = 'commission:' || c.id and c.affiliate_user_id = ${B.id}`) === '1');
  check('2h one SMS «commission paid» to the affiliate', smsPaid(B) === 1, String(smsPaid(B)));

  // ── 3. a manual-approval rule: the admin approves ──
  sql(`update ${S}.commission_rules set manual_approval = true`);
  const o3 = await sentOrder(cp, C);
  check('3x a manual rule: the commission is pending and waits (the worker does not pay it)', coms(o3.number).startsWith('1:pending'), coms(o3.number));
  check('3y the order is sent', await sendIt(cp, o3));
  sql(`update ${S}.commissions set release_at = now() - interval '1 minute' where order_id = ${o3.id}`);
  await tick();
  check('3z released and sent, still NOT paid by the worker', credits(B) === 1);
  const c3 = Number(sql(`select amount from ${S}.commissions where order_id = ${o3.id}`));
  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  const actx = await newCtx();
  const adm = await actx.newPage();
  await adminSignIn(adm, adminPhone, '/admin');
  await adm.goto(`${BASE}/admin`);
  check('3a «نیازمند توجه» counts the commission waiting for a manual approval', (await adm.locator('[data-attention-commissions]').count()) === 1);
  const idB = sql(`select id from ${S}.commissions where affiliate_user_id = ${B.id} and order_id = ${o3.id}`);
  await adm.goto(`${BASE}/admin/commissions?status=pending`);
  check('3b the admin list shows it with its amount and the affiliate', (await adm.locator(`[data-commission-id="${idB}"]`).count()) === 1);
  await adm.locator(`[data-commission-id="${idB}"] [data-commission-approve]`).click();
  await adm.waitForURL(/done=approved/, { timeout: 15000 });
  check('3c approved: paid into the affiliate\'s wallet once (balance = both amounts), one more SMS', coms(o3.number) === `1:paid:${c3}` && balance(B) === c1 + c3 && credits(B) === 2 && smsPaid(B) === 2, `${coms(o3.number)} ${balance(B)} ${credits(B)} ${smsPaid(B)}`);
  await adm.goto(`${BASE}/admin/commissions?status=paid`);
  check('3d a paid commission has no «لغو» button', (await adm.locator(`[data-commission-id="${idB}"] [data-commission-cancel]`).count()) === 0);
  await adm.goto(`${BASE}/admin/commissions?status=paid&phone=${B.phone}`);
  check('3e the admin can filter by the affiliate: only that one\'s commissions', (await adm.locator('[data-commission-id]').count()) === 2);
  sql(`update ${S}.commission_rules set manual_approval = false`);

  // ── 4. a cancelled order pays nothing ──
  const o2 = await sentOrder(cp, C);
  check('4a the third order made a pending commission', coms(o2.number).startsWith('1:pending'), coms(o2.number));
  await cp.goto(`${BASE}/account/orders/${o2.number}`);
  await cp.locator('[data-cancel-open]').click();
  await cp.locator('[data-confirm-dialog="order-cancel"][open]').waitFor();
  await cp.locator('[data-confirm-dialog="order-cancel"] [data-confirm-yes]').click();
  await cp.waitForFunction(() => document.body.innerText.includes('برگشت'), null, { timeout: 15000 });
  await tick();
  const g2 = Number(sql(`select items_total from ${S}.orders where number = '${o2.number}'`));
  check('4b cancelled before payout: the commission cancelled, nothing more credited', coms(o2.number) === `1:cancelled:${Math.floor((g2 * 5) / 100)}` && credits(B) === 2);

  // ── 5. the affiliate's pages ──
  const { page: bp } = await open(B);
  await bp.goto(`${BASE}/account/affiliate`);
  const link = await bp.locator('[data-link]').innerText();
  check('5a the dashboard shows the code and a link /r/<code>; paid = the commission, withdrawable = the paid amount', (await bp.locator('[data-code]').innerText()) === `bb${stamp}x` && link.endsWith(`/r/bb${stamp}x`) && num(await bp.locator('[data-stat-paid]').innerText()) === c1 + c3 && num(await bp.locator('[data-stat-withdrawable]').innerText()) === c1 + c3);
  check('5b the side menu has the affiliate entry (for everyone since task K)', (await bp.locator('[data-account-nav] a[href="/account/affiliate"]').count()) === 1);
  await bp.goto(`${BASE}/account/affiliate/network`);
  const netText = await bp.locator('main, body').first().innerText();
  const last4 = C.phone.slice(-4);
  check("5c B's network: C, only the last four digits, no whole number, no address / order detail, no level filter", (await bp.locator('[data-network-row]').count()) === 1 && netText.includes(last4) && !netText.includes(C.phone) && !/AV-\d/.test(netText) && !/خیابان|پلاک/.test(netText) && (await bp.locator('[data-level-filters]').count()) === 0);
  const { page: ap } = await open(A);
  await ap.goto(`${BASE}/account/affiliate/network`);
  check('5d A sees the two people who signed up through A\'s link (D and E), each a link to their own page', (await ap.locator('[data-network-row]').count()) === 2 && (await ap.locator('[data-person-link]').count()) === 2);
  await bp.goto(`${BASE}/account/affiliate/commissions`);
  const text = await bp.locator('body').innerText();
  check('5f the commissions page lists the own three commissions (two paid, one cancelled) with the status words', (await bp.locator('[data-commission="paid"]').count()) === 2 && (await bp.locator('[data-commission="cancelled"]').count()) === 1 && (await bp.locator('[data-commission]').count()) === 3 && text.includes('واریز شد') && text.includes('لغو شد'));
  check('5g twelve months, the current one carrying the commission', (await bp.locator('[data-month]').count()) === 12 && num(await bp.locator('[data-month] [data-month-total]').last().innerText()) >= c1);
  await bp.goto(`${BASE}/account/affiliate/commissions?status=paid`);
  check('5h the status filter works and the page sum is shown', (await bp.locator('[data-commission]').count()) === 2 && (await bp.locator('[data-page-sum]').count()) === 1);
  const csv = await bp.request.get(`${BASE}/account/affiliate/export`);
  const csvText = await csv.text();
  const idsB = sql(`select string_agg(id::text, ',') from ${S}.commissions where affiliate_user_id = ${B.id}`).split(',');
  const csvIds = csvText.trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[0]);
  check('5i the CSV: B\'s own commissions only, nothing of A, no order numbers or phones', csv.status() === 200 && csvIds.length === idsB.length && csvIds.every((i) => idsB.includes(i)) && !/AV-|09\d{9}/.test(csvText), csvText.slice(0, 120));
  const csvA = await (await ap.request.get(`${BASE}/account/affiliate/export`)).text();
  check('5j and A\'s CSV is A\'s: no row of B', !csvA.split(/\r?\n/).slice(1).some((l) => idsB.includes(l.split(',')[0])));

  // ── 6. who may not ──
  const { page: xp2 } = await open(X);
  await xp2.goto(`${BASE}/account/affiliate`);
  check('6a a plain customer: the programme\'s introduction with the application under it; no code, no data', (await xp2.locator('[data-affiliate-join]').count()) === 1 && (await xp2.locator('[data-affiliate-code]').count()) === 0 && (await xp2.locator('form').count()) >= 1);
  await xp2.goto(`${BASE}/account/affiliate/commissions`);
  check('6b the commissions and network pages are the same notice, no rows', (await xp2.locator('[data-commission]').count()) === 0);
  const csvX = await xp2.request.get(`${BASE}/account/affiliate/export`);
  check('6c the CSV is refused for a plain customer (404)', csvX.status() === 404);
  const anon = await browser.newContext();
  const csvAnon = await anon.request.get(`${BASE}/account/affiliate/export`);
  check('6d and for a visitor who is not signed in (404)', csvAnon.status() === 404);
  check('6e the menu has «همکاری در فروش» for a plain customer too (one address for all three states)', (await xp2.locator('[data-account-nav] a[href="/account/affiliate"]').count()) === 1);
  const adminDenied = await xp2.goto(`${BASE}/admin/commissions`);
  check('6f /admin/commissions is refused for a customer (403)', adminDenied?.status() === 403, String(adminDenied?.status()));

  // ── 7. paid commission → withdrawal ──
  await bp.goto(`${BASE}/account/wallet`);
  await bp.locator('[data-withdraw] input[name="amount"]').fill(String(c1));
  await bp.locator('[data-withdraw] input[name="holder"]').fill('همکار آزمون');
  await bp.locator('[data-withdraw] input[name="iban"]').fill('IR780600000000100324200001');
  await bp.locator('[data-withdraw-submit]').click();
  await bp.waitForFunction(() => document.body.innerText.includes('درخواست برداشت ثبت شد'), null, { timeout: 15000 });
  check('7a the paid commission is withdrawable: the request is accepted and the amount held', sql(`select status::text || ':' || amount from ${S}.withdrawals where user_id = ${B.id}`) === `pending:${c1}` && balance(B) === c3);
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
