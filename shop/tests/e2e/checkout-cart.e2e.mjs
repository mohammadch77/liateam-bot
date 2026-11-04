// The cart after a purchase and the checkout's guidance (task K, A): a paid order takes ITS items out of the cart and only them (what was
// added or raised after the order was made stays), by the wallet and by the gateway; a failed or cancelled payment leaves the cart as it
// was; a repeated callback or a refresh does not touch the cart again; the header shows the new count without a manual refresh. The
// checkout shows its three steps, a summary from the start, a reason under the disabled pay button, and the default address chosen at once.
// Invented numbers, new for every run; the sync bot is the stand-in responder.
import { BASE, SCHEMA as S, check, chromium, finish, requireLocalApp, signIn, sql } from './_harness.mjs';
import { chooseAtGateway, enablePayment, setSetting } from './_pay.mjs';
import { products as two, seeder } from './_seed-order.mjs';
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
    delete from ${S}.wallet_ledger where user_id in (${UIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (${UIDS}));
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.addresses where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS});
    delete from ${S}.users where phone in (${PHONES});
    delete from public.order_jobs where requested_by = 'shop' and done_at is null;`);

const [p1, p2] = two.map(([id]) => id);
const p3 = Number(sql(`select id from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 and id not in (${p1}, ${p2}) order by id limit 1`));
const qtyOf = (u, id) =>
  Number(sql(`select coalesce(sum(i.quantity), 0) from ${S}.cart_items i join ${S}.carts c on c.id = i.cart_id where c.user_id = ${u.id} and c.status = 'open' and i.product_id = ${id}`));
const fill = (u, lines) => {
  sql(`insert into ${S}.carts (user_id) select ${u.id} where not exists (select 1 from ${S}.carts where user_id = ${u.id} and status = 'open')`);
  const cart = sql(`select id from ${S}.carts where user_id = ${u.id} and status = 'open'`);
  for (const [id, q] of lines)
    sql(`insert into ${S}.cart_items (cart_id, product_id, quantity) values (${cart}, ${id}, ${q}) on conflict (cart_id, product_id) do update set quantity = excluded.quantity`);
};
const address = (u) =>
  sql(`insert into ${S}.addresses (user_id, province, city, line, recipient_name, recipient_phone, postal_code, is_default, province_id, city_id, plate)
       values (${u.id}, 'تهران', 'تهران', 'خیابان آزمون، کوچه‌ی تست', 'خریدار آزمون', '${u.phone}', '1234567890', true, 1, 5, '12')`);

const bot = startResponder();
const restorePay = await enablePayment({ 'orders.auto_place_enabled': false });
const browser = await chromium.launch();
const ctxOf = () => browser.newContext({ viewport: { width: 1280, height: 900 } });

try {
  wipe();
  const U = makeUser(1);
  address(U);
  sql(`set search_path = ${S}, public; insert into ${S}.wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) values (${U.id}, 'topup', 90000000, 0, 'topup-k-${stamp}')`);
  const ctx = await ctxOf();
  const p = await ctx.newPage();
  await signIn(p, U.phone);

  // ── 1. the checkout's own guidance: the default address is chosen, the summary is there from the start ──
  fill(U, [[p1, 2], [p2, 1]]);
  await p.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  check('1a the default address is chosen from the start', (await p.locator('input[name="address"]:checked').count()) === 1);
  check('1b the summary shows the goods total from the first moment (before the live check)', (await p.locator('[data-checkout-summary] [data-summary-provisional]').count()) + (await p.locator('[data-checkout-summary] [data-payable]').count()) >= 1);
  check('1c three steps are shown, the first is done or current', (await p.locator('[data-checkout-steps] li').count()) === 3 && (await p.locator('[data-checkout-steps] [data-step="1"]').getAttribute('data-state')) !== 'todo');
  await p.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('1d after the live check the third step is current and the pay button is on, with no reason shown', (await p.locator('[data-checkout-steps] [data-step="3"]').getAttribute('data-state')) === 'current' && (await p.locator('[data-place-order]').isEnabled()) && (await p.locator('[data-pay-blocked]').count()) === 0);

  // ── 2. a wallet purchase empties the cart of its items; the badge follows without a refresh ──
  await p.locator('[data-pay-option="wallet"] input').check();
  await p.locator('[data-place-order]').click();
  await p.waitForURL(/paid=1/, { timeout: 40000 });
  check('2a the wallet purchase took its items out of the cart', qtyOf(U, p1) === 0 && qtyOf(U, p2) === 0, `${qtyOf(U, p1)} ${qtyOf(U, p2)}`);
  await p.waitForFunction(() => ['0', null].includes(document.querySelector('[data-header-action="cart"]')?.getAttribute('data-cart-count') ?? null), null, { timeout: 15000 });
  check('2b the header shows 0 right after the purchase, without a manual refresh', true);

  // ── 3. a gateway purchase: what was added or raised after the order was made stays ──
  fill(U, [[p1, 2], [p2, 1]]);
  await p.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await p.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  await p.locator('[data-pay-option="gateway"] input').check();
  await p.locator('[data-place-order]').click();
  await p.waitForURL(/\/payment\/simulator/, { timeout: 40000 });
  fill(U, [[p1, 3], [p3, 1]]); // while at the bank: one more of p1 and a new product
  await chooseAtGateway(p, 'success');
  await p.locator('[data-callback-result="paid"]').waitFor({ timeout: 20000 });
  check('3a only the ordered quantities are taken out: p1 3-2=1, p2 gone, the new p3 stays', qtyOf(U, p1) === 1 && qtyOf(U, p2) === 0 && qtyOf(U, p3) === 1, `${qtyOf(U, p1)} ${qtyOf(U, p2)} ${qtyOf(U, p3)}`);
  await p.waitForFunction(() => document.querySelector('[data-header-action="cart"]')?.getAttribute('data-cart-count') === '2', null, { timeout: 15000 });
  check('3b the header shows the 2 units that remain', true);
  // a repeated callback / refresh changes nothing
  fill(U, [[p2, 4]]);
  await p.reload();
  await p.locator('[data-callback-repeat="true"]').waitFor({ timeout: 20000 });
  check('3c the same return again (a refresh) does not touch the cart: the later 4 of p2 are still there', qtyOf(U, p2) === 4 && qtyOf(U, p1) === 1);

  // ── 4. a failed or cancelled payment leaves the cart as it was ──
  for (const outcome of ['failed', 'canceled']) {
    fill(U, [[p1, 2], [p2, 2], [p3, 0]]);
    await p.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
    await p.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
    await p.locator('[data-pay-option="gateway"] input').check();
    await p.locator('[data-place-order]').click();
    await p.waitForURL(/\/payment\/simulator/, { timeout: 40000 });
    await chooseAtGateway(p, outcome);
    check(`4 ${outcome}: the cart is exactly as it was (p1 2, p2 2)`, qtyOf(U, p1) === 2 && qtyOf(U, p2) === 2, `${qtyOf(U, p1)} ${qtyOf(U, p2)}`);
  }

  // ── 5. a reason under the pay button: no address, no online payment ──
  const W = makeUser(2); // no address, no wallet
  const wctx = await ctxOf();
  const w = await wctx.newPage();
  await signIn(w, W.phone);
  fill(W, [[p1, 1]]);
  await w.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await w.locator('[data-address-form]').waitFor();
  check('5a no address yet: the pay button is off and says «آدرس تحویل را انتخاب کنید»', (await w.locator('[data-place-order]').isDisabled()) && /آدرس/.test(await w.locator('[data-pay-blocked]').innerText()));
  await w.getByLabel('نام و نام خانوادگی گیرنده').fill('آزمون تست');
  await w.getByLabel('استان').selectOption({ label: 'تهران' });
  await w.waitForFunction(() => document.querySelectorAll('select[name="city"] option').length > 1, null, { timeout: 30000 });
  await w.getByLabel('شهر').selectOption({ label: 'تهران' });
  await w.getByLabel('کد پستی').fill('1234567890');
  await w.getByLabel('پلاک').fill('12');
  await w.getByLabel('نشانی کامل').fill('خیابان آزمون، کوچه‌ی تست');
  await w.getByRole('button', { name: 'ذخیره و ادامه' }).click();
  await w.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('5b after the address is saved the review runs by itself and the second step is current / done', (await w.locator('[data-checkout-steps] [data-step="1"]').getAttribute('data-state')) === 'done');
  await setSetting('payment.enabled', false);
  await w.reload({ waitUntil: 'domcontentloaded' });
  await w.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('5c online payment off and an empty wallet: the button is off and says why («پرداخت آنلاین فعلاً در دسترس نیست»)', (await w.locator('[data-place-order]').isDisabled()) && /آنلاین فعلاً در دسترس نیست/.test(await w.locator('[data-pay-blocked]').innerText()));
  check('5d the saved address (the only one, so the default) is chosen at the next visit', (await w.locator('input[name="address"]:checked').count()) === 1);
  await ctx.close();
  await wctx.close();
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
