// The affiliate's programme as task K made it, end to end: the referral link -> a first sign-up -> a paid order -> the commission shows
// as pending at once (and the same buyer's NEXT order, bought without the link, earns again); the referred person's own page with
// their orders (masked numbers, the percent applied), its Excel file and who may open it (another affiliate, a customer, a made-up
// token: no data); the QR of the link (decoded back to the link, with its quiet zone) and the printable banner; ONE level only (a
// referred person is no affiliate and brings no referrals; the admin is warned); the typed code at sign-in and at checkout, locked
// once recorded; and the admin's warning when no rule can make a commission. Invented numbers, new for every run.
import { unzipSync, strFromU8 } from 'fflate';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { BASE, SCHEMA as S, check, chromium, finish, requireLocalApp, sql } from './_harness.mjs';
import { NET, makeAdmin, signIn as adminSignIn } from './_admin-login.mjs';
import { enablePayment } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09995', stamp);
const PHONES = `select phone from ${S}.users where phone like '09995%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
if (Number(sql(`select count(*) from ${S}.commission_rules`)) > 0) {
  console.error('commission_rules is not empty in the local database; this test replaces its rows. Empty it first.');
  process.exit(2);
}
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where order_id in (${OIDS}) or affiliate_user_id in (${UIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.affiliate_applications where user_id in (${UIDS});
    delete from ${S}.affiliate_referrals where buyer_user_id in (${UIDS}) or referrer_user_id in (${UIDS});
    delete from ${S}.affiliate_codes where user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.addresses where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'user' and entity_id in (select id::text from ${S}.users where phone in (${PHONES})));
    delete from ${S}.users where phone in (${PHONES});
    delete from public.order_jobs where requested_by = 'shop' and done_at is null;
    delete from ${S}.commission_rules;`);

const idOf = (p) => sql(`select id from ${S}.users where phone = '${p}'`);
const refOf = (p) => sql(`select coalesce((select referrer_user_id::text from ${S}.affiliate_referrals where buyer_user_id = (select id from ${S}.users where phone = '${p}')), '')`);
const coms = (n) => sql(`select coalesce(string_agg(level || ':' || status::text || ':' || amount, ',' order by id), '') from ${S}.commissions where order_id = (select id from ${S}.orders where number = '${n}')`);

const bot = startResponder();
const restorePay = await enablePayment({ 'orders.auto_place_enabled': false });
const browser = await chromium.launch();
let ipn = 0;
/** each context has its own client address: the sign-in quota is per address and per hour */
const newCtx = () => browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-real-ip': `10.${NET}.${90 + ++ipn}.1` } });
const open = async (phoneNo, next = '/') => {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await adminSignIn(page, phoneNo, next);
  return { ctx, page };
};
/** an order seeded as the checkout leaves it, paid from the wallet through the real page */
async function paidOrder(page, user) {
  const o = seedOrder(user);
  await page.goto(`${BASE}/account/orders/${o.number}`);
  await page.locator('[data-pay-option="wallet"] input').check();
  await page.locator('[data-pay-submit]').click();
  await page.waitForURL(/paid=1/, { timeout: 40000 });
  return o;
}
const fund = (u, key) =>
  sql(`set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${u.id}, 'topup', 90000000, 0, '${key}-${stamp}')`);

try {
  wipe();
  const A = makeUser(1); // the affiliate
  const A2 = makeUser(2); // another affiliate
  const X = makeUser(3); // a plain customer (no referrer, no paid order)
  for (const u of [A, A2]) sql(`insert into ${S}.user_roles (user_id, role) values (${u.id}, 'affiliate')`);
  const codeA = `aa${stamp}x`;
  const codeA2 = `bb${stamp}x`;
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${A.id}, '${codeA}'), (${A2.id}, '${codeA2}')`);
  sql(`insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active, manual_approval) values ('r1', 'percent', 10, 'all', 1, 3, true, false)`);

  // ── 1. link -> sign-up -> paid order: the commission is there at once; the next order, bought without the link, earns too ──
  const lctx = await newCtx();
  const lp = await lctx.newPage();
  await lp.goto(`${BASE}/r/${codeA}`);
  const N = { phone: phone(4) };
  await adminSignIn(lp, N.phone, '/');
  N.id = idOf(N.phone);
  check('1a the first sign-up through the link is attached to the affiliate', refOf(N.phone) === A.id, refOf(N.phone));
  sql(`insert into ${S}.user_roles (user_id, role) select ${N.id}, 'customer' where not exists (select 1 from ${S}.user_roles where user_id = ${N.id})`);
  fund(N, 'k1');
  const o1 = await paidOrder(lp, N);
  const g1 = Number(sql(`select items_total from ${S}.orders where number = '${o1.number}'`));
  check('1b the paid order made a pending commission (10% of the goods, rounded down), with the rule\'s percent kept on the row', coms(o1.number) === `1:pending:${Math.floor(g1 / 10)}` && sql(`select rule_kind || ':' || rule_value::float8 from ${S}.commissions where order_id = (select id from ${S}.orders where number = '${o1.number}')`) === 'percent:10', coms(o1.number));
  await lctx.clearCookies(); // the next purchase has no link, and the session is not the point: sign in again
  await adminSignIn(lp, N.phone, '/');
  const o2 = await paidOrder(lp, N);
  check('1c a LATER order of the same buyer, bought without the link, earns the same referrer a commission (task K item 6)', coms(o2.number).startsWith('1:pending:'), coms(o2.number));
  const { page: ap, ctx: actx } = await open(A.phone, '/account/affiliate/commissions');
  await ap.goto(`${BASE}/account/affiliate/commissions`);
  const pendingText = await ap.locator('main').innerText();
  check('1d the affiliate sees both as «در انتظار» right after payment, with «بعد از ارسال سفارش و پایان مهلت، به کیف پول شما واریز می‌شود»', (await ap.locator('[data-commission="pending"]').count()) === 2 && pendingText.includes('بعد از ارسال سفارش و پایان مهلت، به کیف پول شما واریز می‌شود'));
  await ap.goto(`${BASE}/account/affiliate`);
  check('1e the dashboard counts them as pending', !/^0\b/.test((await ap.locator('[data-stat-pending]').innerText()).replace(/[^\d۰-۹]/g, '') || '0'));

  // ── 2. the referred person's page ──
  await ap.goto(`${BASE}/account/affiliate/network`);
  check('2a the network lists the person as a link (one level: no level filter)', (await ap.locator('[data-person-link]').count()) === 1 && (await ap.locator('[data-level-filters]').count()) === 0);
  await ap.locator('[data-person-link]').click();
  await ap.waitForURL(/\/account\/affiliate\/network\/[0-9a-z]+-[0-9a-f]{12}$/);
  const personUrl = ap.url();
  const body = await ap.locator('main').innerText();
  check('2b the page lists their two paid orders with masked numbers and the percent applied; no name of a good, no address, no whole number', (await ap.locator('[data-person-order]').count()) === 2 && (await ap.locator('[data-order-code]').first().innerText()).includes('••') && /10٪/.test(body.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) && !body.includes(N.phone) && !/خیابان|پلاک/.test(body) && !/AV-\d{6}/.test(body));
  const totalsOrders = (await ap.locator('[data-total-orders]').innerText()).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  check('2c the totals above: two orders', totalsOrders === '2');
  check('2d the page offers Excel and the print-to-PDF button', (await ap.locator('[data-xlsx]').count()) === 1 && (await ap.locator('[data-print-pdf]').count()) === 1);
  const x = await ap.request.get(`${personUrl}/export`);
  const xb = Buffer.from(await x.body());
  let sheet = '';
  try {
    sheet = strFromU8(unzipSync(new Uint8Array(xb))['xl/worksheets/sheet1.xml']);
  } catch {
    /* not a zip */
  }
  check('2e the Excel file is a real .xlsx of the person\'s two orders (a header row + two), right-to-left', x.status() === 200 && xb.subarray(0, 2).toString() === 'PK' && (sheet.match(/<row /g) ?? []).length === 3 && sheet.includes('rightToLeft="1"'), `${x.status()} ${sheet.slice(0, 80)}`);
  check('2f …and it has no phone number and no whole order number', !sheet.includes(N.phone) && !/AV-\d{6}/.test(sheet));
  const cx = await ap.request.get(`${BASE}/account/affiliate/export?format=xlsx`);
  check('2g the commissions list has an Excel file too, and the CSV still works', cx.status() === 200 && (await ap.request.get(`${BASE}/account/affiliate/export`)).status() === 200);
  // who may not
  const { page: bp } = await open(A2.phone, '/');
  const other = await bp.goto(personUrl);
  check('2h ANOTHER affiliate opening that address: 404, no data', other?.status() === 404 && (await bp.locator('[data-person-order]').count()) === 0, String(other?.status()));
  check('2i … and its Excel file: 404', (await bp.request.get(`${personUrl}/export`)).status() === 404);
  const made = await bp.goto(`${BASE}/account/affiliate/network/zzzz-000000000000`);
  check('2j a made-up token: 404', made?.status() === 404);
  const { page: np } = await open(N.phone, '/');
  await np.goto(personUrl);
  check('2k the referred person themself (not an affiliate): no data at that address', (await np.locator('[data-person-order]').count()) === 0 && (await np.request.get(`${personUrl}/export`)).status() === 404);
  const anon = await browser.newContext();
  check('2l a visitor not signed in: the Excel file is 404', (await anon.request.get(`${personUrl}/export`)).status() === 404);
  let limited = 0;
  for (let i = 0; i < 8 && !limited; i++) if ((await ap.request.get(`${personUrl}/export`)).status() === 429) limited = i + 1;
  check('2m downloads are rate limited (429 after a few in a row)', limited > 0, String(limited));

  // ── 3. the QR and the banner ──
  await ap.goto(`${BASE}/account/affiliate`);
  check('3a the dashboard explains the three uses and shows the QR', (await ap.locator('[data-affiliate-uses] li').count()) === 3 && (await ap.locator('[data-qr]').count()) === 1);
  const png = await ap.request.get(`${BASE}/account/affiliate/qr?f=png`);
  const img = PNG.sync.read(Buffer.from(await png.body()));
  const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  check('3b the PNG decodes to the affiliate\'s own link', png.status() === 200 && decoded?.data === `${BASE}/r/${codeA}`, decoded?.data ?? 'no decode');
  let firstDark = img.width;
  for (let y = 0; y < img.height; y += 4)
    for (let xx = 0; xx < img.width; xx++) {
      if (img.data[(y * img.width + xx) * 4] < 100) {
        firstDark = Math.min(firstDark, xx);
        break;
      }
    }
  check('3c the quiet zone is kept (at least 4 modules of white on the left: well over 4% of the width)', firstDark / img.width >= 0.04, `${firstDark}/${img.width}`);
  const svg = await ap.request.get(`${BASE}/account/affiliate/qr?f=svg&download=1`);
  check('3d the SVG downloads as a file', svg.status() === 200 && (await svg.text()).includes('<svg') && /attachment/.test(svg.headers()['content-disposition'] ?? ''));
  await ap.goto(`${BASE}/account/affiliate/banner`);
  check('3e the printable banner (A5) has the big QR and the code', (await ap.locator('[data-banner-qr] svg').count()) === 1 && (await ap.locator('[data-banner-code]').innerText()) === codeA);
  check('3f the QR is the affiliate\'s own: a customer gets 404', (await np.request.get(`${BASE}/account/affiliate/qr`)).status() === 404);

  // ── 4. one level only ──
  const B = makeUser(5); // an affiliate who was referred (older data): the code brings no new referrals
  sql(`insert into ${S}.user_roles (user_id, role) values (${B.id}, 'affiliate')`);
  sql(`insert into ${S}.affiliate_codes (user_id, code) values (${B.id}, 'cc${stamp}x')`);
  sql(`insert into ${S}.affiliate_referrals (buyer_user_id, referrer_user_id, code) values (${B.id}, ${A.id}, '${codeA}')`);
  const c4 = await newCtx();
  const p4 = await c4.newPage();
  await p4.goto(`${BASE}/r/cc${stamp}x`);
  const N4 = { phone: phone(6) };
  await adminSignIn(p4, N4.phone, '/');
  check('4a a new sign-up through the link of an affiliate who was himself referred is not attached (no second level)', refOf(N4.phone) === '', refOf(N4.phone));
  await np.goto(`${BASE}/account/affiliate`);
  check('4b a referred customer sees why the application is closed, no form', (await np.locator('[data-affiliate-referred]').count()) === 1 && (await np.locator('main form').count()) === 0);
  sql(`insert into ${S}.affiliate_applications (user_id, full_name, phone, province, city, channel_type, channel_url, description) values (${N.id}, 'متقاضی معرف‌دار', '${N.phone}', 'تهران', 'تهران', 'instagram', '@x', 'توضیح درخواست برای آزمون، بیش از بیست حرف')`);
  makeAdmin(phone(9));
  const { page: adm } = await open(phone(9), '/admin/affiliates');
  await adm.goto(`${BASE}/admin/affiliates`);
  check('4c the admin sees the warning on the referred applicant and no «تأیید» button', (await adm.locator('[data-referred-applicant]').count()) === 1 && (await adm.locator('[data-application] button[value="approve"]').count()) === 0);
  check('4d the admin sees the count of affiliates who were themselves referred', (await adm.locator('[data-referred-affiliates]').count()) === 1);
  sql(`delete from ${S}.commission_rules`);
  await adm.goto(`${BASE}/admin/commissions`);
  check('4e with no usable rule the admin\'s commissions page warns «هیچ قاعده‌ی پورسانت فعالی نیست»', (await adm.locator('[data-no-rule-warning]').count()) === 1);
  await adm.goto(`${BASE}/admin`);
  check('4f … and «نیازمند توجه» says so', (await adm.locator('[data-attention-no-rule]').count()) === 1);
  sql(`insert into ${S}.commission_rules (name, kind, value, scope_type, level, hold_days, active, manual_approval) values ('r1', 'percent', 10, 'all', 1, 3, true, false)`);

  // ── 5. the typed code: at sign-in and at checkout, locked once recorded ──
  const c5 = await newCtx();
  const p5 = await c5.newPage();
  const N5 = { phone: phone(7) };
  sql(`delete from ${S}.otp_codes where phone = '${N5.phone}'`);
  await p5.goto(`${BASE}/login`);
  await p5.locator('main').getByLabel('شماره موبایل').fill(N5.phone);
  await p5.locator('main').getByLabel('کد معرف').fill('nosuchcode');
  await p5.getByRole('button', { name: 'دریافت کد تأیید' }).click();
  await p5.waitForFunction(() => document.body.innerText.includes('کد معرف معتبر نیست'), null, { timeout: 15000 });
  check('5a a wrong code at sign-in stops with its message (no SMS is sent)', (await p5.getByRole('textbox', { name: 'کد تأیید', exact: true }).count()) === 0);
  const c6 = await newCtx();
  const p6 = await c6.newPage();
  const N6 = { phone: phone(8) };
  sql(`delete from ${S}.otp_codes where phone = '${N6.phone}'`);
  await p6.goto(`${BASE}/login`);
  await p6.locator('main').getByLabel('شماره موبایل').fill(N6.phone);
  await p6.locator('main').getByLabel('کد معرف').fill(` ${codeA2.toUpperCase()} `);
  await p6.getByRole('button', { name: 'دریافت کد تأیید' }).click();
  await p6.getByRole('textbox', { name: 'کد تأیید', exact: true }).waitFor({ timeout: 15000 });
  const code6 = (await import('node:fs')).readFileSync(process.env.E2E_SERVER_LOG, 'utf8').split('\n').filter((l) => l.includes('sms.dev.otp') && l.includes(`${N6.phone.slice(0, 4)}•••${N6.phone.slice(-4)}`)).at(-1);
  await p6.getByRole('textbox', { name: 'کد تأیید', exact: true }).fill(JSON.parse(code6.slice(code6.indexOf('{'))).devCode);
  await p6.getByRole('button', { name: 'ورود', exact: true }).click();
  await p6.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  check('5b a valid typed code (any case, with spaces) at the FIRST sign-up attaches the referrer', refOf(N6.phone) === A2.id, refOf(N6.phone));
  // at checkout
  const pr = sql(`select id from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 order by id limit 1`);
  const prep = (u) => {
    sql(`insert into ${S}.addresses (user_id, province, city, line, recipient_name, recipient_phone, postal_code, is_default, province_id, city_id, plate) values (${u.id}, 'تهران', 'تهران', 'خیابان آزمون، کوچه‌ی تست', 'خریدار', '${u.phone}', '1234567890', true, 1, 5, '12')`);
    sql(`insert into ${S}.carts (user_id) values (${u.id})`);
    sql(`insert into ${S}.cart_items (cart_id, product_id, quantity) select id, ${pr}, 1 from ${S}.carts where user_id = ${u.id} and status = 'open'`);
  };
  const { page: xp } = await open(X.phone, '/');
  prep(X);
  await xp.goto(`${BASE}/checkout`);
  check('5c a customer with no referrer and no paid order sees the code box at checkout', (await xp.locator('[data-referral-box] input[name="ref"]').count()) === 1);
  await xp.locator('[data-referral-box] input[name="ref"]').fill('nosuchcode');
  await xp.locator('[data-referral-box] button[type="submit"]').click();
  await xp.waitForFunction(() => document.querySelector('[data-referral-box]')?.textContent?.includes('معتبر نیست'), null, { timeout: 15000 });
  check('5d a wrong code is refused on the server with a message; nothing recorded', refOf(X.phone) === '');
  await xp.locator('[data-referral-box] input[name="ref"]').fill(`   ${codeA.toUpperCase()}`);
  await xp.locator('[data-referral-box] button[type="submit"]').click();
  await xp.locator('[data-referral-locked]').waitFor({ timeout: 15000 });
  check('5e a right code is recorded and the box is locked at once', refOf(X.phone) === A.id && (await xp.locator('[data-referral-box] input[name="ref"]').count()) === 0);
  await xp.reload();
  check('5f after a reload it is still locked, showing the code (it cannot be changed)', (await xp.locator('[data-referral-locked]').innerText()).includes(codeA));
  const second = sql(`select count(*) from ${S}.affiliate_referrals where buyer_user_id = ${X.id}`);
  check('5g exactly one referrer row', second === '1');
  const { page: ap2 } = await open(A.phone, '/');
  await ap2.goto(`${BASE}/checkout`).catch(() => {});
  check('5h an affiliate (the code\'s owner) has no code box', (await ap2.locator('[data-referral-box]').count()) === 0);
  const Y = makeUser(0); // a customer whose first order is already paid: too late for a code
  fund(Y, 'k5');
  const { page: yp } = await open(Y.phone, '/');
  await paidOrder(yp, Y);
  prep(Y);
  await yp.goto(`${BASE}/checkout`);
  check('5i after a paid order the box is gone: the code only works before the first purchase', (await yp.locator('[data-referral-box]').count()) === 0);
  await actx.close();
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
