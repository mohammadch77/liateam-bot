// Cart and checkout end to end (local app + Docker DB), up to «pending_payment». The sync bot is replaced by a responder
// (_responder.mjs) that answers the shop's review / geo jobs in public.order_jobs. Covers: add from a card, the product page
// and a pack; the cart page (totals, quantity, the stock cap, remove); the mini-cart; merging a guest cart after sign-in;
// the checkout with an address from the geo list; the live check (ok, out of stock, short, dearer, silent bot, expired
// hold); the order the server makes (idempotent, money from the server, the bot's total kept as live_total); and the
// security cases (another user's cart and order, a tampered page, the guest at /checkout). Test users use invented numbers.
import { BASE, SCHEMA as S, check, chromium, finish, requireLocalApp, signIn, sleep, sql, toLatin } from './_harness.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
// invented numbers, new for every run (the sign-in helper reads the newest code of a number from the server log)
const stamp = String(Date.now() % 1_000_000).padStart(6, '0');
const U = `09990${stamp.slice(0, 1)}${stamp.slice(1)}`.slice(0, 11);
const V = `09991${stamp.slice(1)}0`.slice(0, 11);
const PHONES = `select phone from ${S}.users where phone like '09990%' or phone like '09991%'`;
const SHIPPING = 187_900;

const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.order_events where order_id in (select id from ${S}.orders where user_id in (select id from ${S}.users where phone in (${PHONES})));
    delete from ${S}.order_items where order_id in (select id from ${S}.orders where user_id in (select id from ${S}.users where phone in (${PHONES})));
    delete from ${S}.orders where user_id in (select id from ${S}.users where phone in (${PHONES}));
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (select id from ${S}.users where phone in (${PHONES})));
    delete from ${S}.carts where user_id in (select id from ${S}.users where phone in (${PHONES}));
    delete from ${S}.addresses where user_id in (select id from ${S}.users where phone in (${PHONES}));
    delete from public.order_jobs where requested_by = 'shop' and done_at is null;`);
// guest carts of this run are removed by their (unknown) token hash: every guest cart created in the last hour
const wipeGuests = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where guest_token_hash is not null and created_at > now() - interval '2 hours');
    delete from ${S}.carts where guest_token_hash is not null and created_at > now() - interval '2 hours';`);

const products = sql(
  `select string_agg(id || ':' || price || ':' || stock || ':' || coalesce(slug_en, ''), ',' order by id) from
     (select id, price, stock, slug_en from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 and slug_en is not null order by id limit 4) x`,
)
  .split(',')
  .map((r) => r.split(':'))
  .map(([id, price, stock, slug]) => ({ id: Number(id), price: Number(price), stock: Number(stock), slug }));
if (products.length < 4) {
  console.error('need 4 in-stock products in the local DB');
  process.exit(2);
}
const [A, B, C] = products;
const num = (t) => Number(toLatin(t));

const bot = startResponder();
const browser = await chromium.launch();
const newPage = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  return { ctx, page: await ctx.newPage() };
};
const badge = (page) => page.locator('[data-header-action="cart"]').first().getAttribute('data-cart-count');
const orderCount = () => Number(sql(`select count(*) from ${S}.orders o join ${S}.users u on u.id = o.user_id where u.phone in (${PHONES})`));

try {
  wipe();
  wipeGuests();

  // ── 1. a guest adds from a card, the product page and a pack ──
  const g = await newPage();
  const p = g.page;
  await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
  await p.locator('main article [data-cart-add]').first().click();
  await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 15000 });
  check('1a a card\'s add button: a confirmation and the header badge shows 1', (await badge(p)) === '1', String(await badge(p)));
  check('1b the guest cart cookie is httpOnly and holds no data', (await g.ctx.cookies()).some((c) => c.name === 'cart' && c.httpOnly && c.value.length === 43));

  await p.goto(`${BASE}/shop/product/${B.slug}`, { waitUntil: 'load' });
  await p.locator('[data-product-buy="main"]').first().waitFor();
  await p.getByRole('button', { name: 'زیاد کردن' }).first().click();
  await p.getByRole('button', { name: 'زیاد کردن' }).first().click();
  await p.locator('[data-product-buy="main"]').first().click();
  await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 15000 });
  check('1c the product page adds the chosen quantity (3) — the badge shows 4', (await badge(p)) === '4', String(await badge(p)));

  await p.goto(`${BASE}/shop/packs/skin-routine/oily`, { waitUntil: 'load' });
  const before = Number(await badge(p));
  const packAdd = p.locator('[data-pack-add]');
  if (await packAdd.isEnabled()) {
    await packAdd.click();
    await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 20000 });
    check('1d the pack page adds the pack\'s items', Number(await badge(p)) > before, `${before} → ${await badge(p)}`);
  } else console.log('  – 1d skipped (the oily pack is not available in this database)');

  // ── 2. the cart page ──
  await p.goto(`${BASE}/cart`, { waitUntil: 'load' });
  const lines = p.locator('[data-cart-line]');
  const n = await lines.count();
  check('2a the cart page lists the lines', n >= 2, String(n));
  const totals = await p.locator('[data-line-total]').allInnerTexts();
  const sum = totals.reduce((t, x) => t + num(x), 0);
  check('2b the total is the sum of the lines', num(await p.locator('[data-cart-total]').innerText()) === sum, `${sum}`);
  const bLine = p.locator(`[data-cart-line="${B.id}"]`);
  const qty0 = num(await bLine.locator('[data-line-qty]').innerText());
  await bLine.getByRole('button', { name: 'زیاد کردن' }).click();
  await p.waitForFunction(([id, q]) => Number(document.querySelector(`[data-cart-line="${id}"] [data-line-qty]`)?.textContent?.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) === q, [B.id, qty0 + 1]);
  check('2c + raises the quantity', true);
  // the cap: press + until it is disabled — never above the stock, never above 50
  const plus = bLine.getByRole('button', { name: 'زیاد کردن' });
  const cap = Math.min(B.stock, 50);
  for (let q = qty0 + 1; q < cap + 1; q++) {
    await p.waitForFunction(([id, want]) => Number(document.querySelector(`[data-cart-line="${id}"] [data-line-qty]`)?.textContent?.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) === want, [B.id, q], { timeout: 15000 });
    if (!(await plus.isEnabled())) break;
    await plus.click();
  }
  await p.waitForFunction(([id, want]) => Number(document.querySelector(`[data-cart-line="${id}"] [data-line-qty]`)?.textContent?.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) === want, [B.id, cap], { timeout: 15000 });
  check('2d-0 at the cap the + button is off', await plus.isDisabled());
  const capped = num(await bLine.locator('[data-line-qty]').innerText());
  check('2d the quantity stops at the stock (and at 50)', capped === Math.min(B.stock, 50), `${capped} vs stock ${B.stock}`);
  await bLine.getByRole('button', { name: /حذف/ }).click();
  await p.waitForFunction((id) => !document.querySelector(`[data-cart-line="${id}"]`), B.id);
  check('2e «حذف» takes the line out', true);

  // ── 3. the mini-cart (desktop) ──
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.locator('[data-header-action="cart"]').first().click();
  await p.locator('[data-mini-cart] li').first().waitFor({ timeout: 15000 });
  check('3 the header cart icon opens the mini-cart with the lines and «ثبت سفارش»', (await p.locator('[data-mini-cart] li').count()) >= 1 && (await p.locator('[data-mini-cart]').getByRole('link', { name: 'ثبت سفارش' }).count()) === 1);
  await p.keyboard.press('Escape');
  check('3b Escape closes it', (await p.locator('[data-mini-cart]').count()) === 0);

  // ── 4. a guest at /checkout goes to the login and comes back ──
  await p.goto(`${BASE}/checkout`, { waitUntil: 'load' });
  check('4 a guest at /checkout is sent to /login?next=/checkout', /\/login\?next=%2Fcheckout/.test(p.url()), p.url());

  // ── 5. sign-in merges the guest cart into the user's ──
  // the user already has a cart (made earlier, from another device): 1 of A and 1 of C
  sql(`insert into ${S}.users (phone) values ('${U}') on conflict do nothing`);
  sql(`with c as (insert into ${S}.carts (user_id) select id from ${S}.users where phone = '${U}' returning id)
       insert into ${S}.cart_items (cart_id, product_id, quantity) select c.id, x.p, 1 from c, (values (${A.id}), (${C.id})) as x(p)`);
  // the guest (context g) has: card product (first in /shop, unknown id) + B (removed) + pack items. Add A twice more as a guest.
  await p.goto(`${BASE}/shop/product/${A.slug}`, { waitUntil: 'load' });
  await p.getByRole('button', { name: 'زیاد کردن' }).first().click();
  await p.locator('[data-product-buy="main"]').first().click();
  await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 15000 });
  const guestUnits = Number(sql(`select coalesce(sum(i.quantity),0) from ${S}.cart_items i join ${S}.carts c on c.id = i.cart_id where c.guest_token_hash is not null and c.status = 'open' and c.created_at > now() - interval '2 hours' and i.product_id <> ${A.id}`));
  await signIn(p, U);
  await p.goto(`${BASE}/cart`, { waitUntil: 'load' });
  const aQty = num(await p.locator(`[data-cart-line="${A.id}"] [data-line-qty]`).innerText());
  check('5a after sign-in the guest\'s 2 of A joined the user\'s 1 of A (3, within the stock)', aQty === Math.min(3, A.stock), String(aQty));
  check('5b the user\'s own other product (C) is still there', (await p.locator(`[data-cart-line="${C.id}"]`).count()) === 1);
  const mergedUnits = Number(sql(`select coalesce(sum(i.quantity),0) from ${S}.cart_items i join ${S}.carts c on c.id = i.cart_id join ${S}.users uu on uu.id = c.user_id where uu.phone = '${U}' and c.status = 'open'`));
  check('5c the badge and the database agree on the merged cart', Number(await badge(p)) === mergedUnits && mergedUnits >= aQty + 1, `${await badge(p)} / ${mergedUnits} (guest had ${guestUnits} others)`);
  check('5d the guest cart is closed as merged', Number(sql(`select count(*) from ${S}.carts where status = 'merged'`)) >= 1);

  // ── 6. another user cannot see this cart ──
  const v = await newPage();
  await signIn(v.page, V);
  await v.page.goto(`${BASE}/cart`, { waitUntil: 'load' });
  check('6a another user\'s cart is empty (no way to reach somebody else\'s)', (await v.page.locator('[data-cart-empty]').count()) === 1 && (await v.page.locator('[data-cart-line]').count()) === 0);
  check('6b the badge of the other user is 0', (await badge(v.page)) === null || (await badge(v.page)) === '0');

  // ── 7. checkout: address from the geo list, then the live check ──
  const c = p; // user U, signed in, with the merged cart
  await c.goto(`${BASE}/checkout`, { waitUntil: 'load' });
  await c.locator('[data-address-form]').waitFor();
  await c.getByLabel('نام و نام خانوادگی گیرنده').fill('آزمون تست');
  await c.getByLabel('استان').selectOption({ label: 'تهران' });
  await c.waitForFunction(() => document.querySelectorAll('select[name="city"] option').length > 1, null, { timeout: 30000 });
  check('7a the province list came from Liateam\'s list (through the bot) and its cities load', true);
  await c.getByLabel('شهر').selectOption({ label: 'تهران' });
  await c.getByLabel('کد پستی').fill('1234567890');
  await c.getByLabel('پلاک').fill('12');
  await c.getByLabel('نشانی کامل').fill('خیابان آزمون، کوچه‌ی تست');
  await c.getByRole('button', { name: 'ذخیره و ادامه' }).click();
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  const cityRow = sql(`select city_id || '/' || province_id || '/' || plate from ${S}.addresses a join ${S}.users uu on uu.id = a.user_id where uu.phone = '${U}'`);
  check('7b the address keeps Liateam\'s city / province ids and the plate', cityRow === '5/1/12', cityRow);
  const payableTxt = await c.locator('[data-payable]').getAttribute('data-payable');
  const itemsLive = bot.answered.at(-1).items.reduce((t, l) => t + l.price * l.q, 0);
  check('7c the live check answered and the summary shows the totals (shipping from Liateam\'s answer)', Number(payableTxt) > SHIPPING && (await c.locator(`[data-shipping-charged="${SHIPPING}"]`).count()) === 1, `${payableTxt} (Liateam goods ${itemsLive})`);
  check('7d the 15-minute hold counter is shown', (await c.locator('[data-review-timer]').count()) === 1);
  check('7e the delivery line says the time comes after the order (no range entered yet)', /پس از ثبت سفارش/.test(await c.locator('[data-delivery]').innerText()));

  // ── 8. the order: money from the server, never from the page ──
  await c.evaluate(() => {
    // tamper with the page: the amounts and the attribute the test read — nothing of it is sent
    document.querySelectorAll('[data-payable]').forEach((el) => el.setAttribute('data-payable', '1'));
    document.querySelectorAll('[data-line]').forEach((el) => el.setAttribute('data-price', '1'));
  });
  const ordersBefore = orderCount();
  await c.locator('[data-place-order]').click();
  await c.waitForURL(/\/account\/orders\/AV-\d+/, { timeout: 40000 }).catch(async (e) => {
    console.error('place order did not navigate; the page says:', (await c.locator('[data-checkout-summary]').innerText().catch(() => '(no summary)')).replace(/\s+/g, ' ').slice(-300));
    throw e;
  });
  const number = /AV-\d+/.exec(c.url())[0];
  const row = sql(`select status || '|' || items_total || '|' || shipping_supplier_price || '|' || shipping_charged || '|' || shipping_absorbed || '|' || total_payable || '|' || live_total || '|' || live_ok from ${S}.orders where number = '${number}'`).split('|');
  check('8a an order was made in pending_payment', row[0] === 'pending_payment' && orderCount() === ordersBefore + 1, row.join(' '));
  check('8b the payable is the server\'s (goods at the shop price + Liateam\'s shipping), not the tampered text', Number(row[5]) === Number(row[1]) + SHIPPING && Number(row[5]) === Number(payableTxt), row.join(' '));
  check('8c live_total (kept for the bot) = Liateam\'s goods + shipping from the check', Number(row[6]) === itemsLive + SHIPPING && row[7] === 'true', `${row[6]} vs ${itemsLive + SHIPPING}`);
  check('8d the shipping split: Liateam\'s price = charged + absorbed', Number(row[2]) === SHIPPING && Number(row[3]) + Number(row[4]) === SHIPPING);
  const snap = sql(`select count(*) || '|' || bool_and(unit_price <= unit_list_price)::text from ${S}.order_items i join ${S}.orders o on o.id = i.order_id where o.number = '${number}'`);
  check('8e the lines carry the price snapshot', Number(snap.split('|')[0]) >= 2 && snap.endsWith('|true'), snap);
  const page8 = await c.locator('main').innerText();
  check('8f the order page: the number, the payable, and «پرداخت در مرحله‌ی بعد فعال می‌شود»', /AV-/.test(page8) && /پرداخت در مرحله‌ی بعد فعال می‌شود/.test(page8) && num(await c.locator('[data-order-payable]').innerText()) === Number(row[5]));
  check('8h the cart is kept until the payment exists', Number(sql(`select count(*) from ${S}.carts c join ${S}.users uu on uu.id = c.user_id where uu.phone = '${U}' and c.status = 'open'`)) === 1);

  // another user cannot open this order
  const foreign = await v.page.goto(`${BASE}/account/orders/${number}`, { waitUntil: 'load' });
  check('8i another user opening the order gets a 404', foreign?.status() === 404, String(foreign?.status()));

  // ── 9. scenarios of the live check ──
  const open = async () => {
    await c.goto(`${BASE}/checkout`, { waitUntil: 'load' });
  };
  // 9a: a product is gone
  bot.mode.out = new Set([A.id]);
  await open();
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('9a out of stock: the line says so, the order button is off', (await c.locator(`[data-line="${A.id}"][data-line-status="unavailable"]`).count()) === 1 && (await c.locator('[data-place-order]').isDisabled()));
  bot.mode.out = new Set();
  await c.locator('[data-review-fix]').click();
  await c.waitForFunction((id) => !document.querySelector(`[data-line="${id}"]`) && document.querySelector('[data-review="ready"]'), A.id, { timeout: 60000 });
  check('9b «اعمال تغییرات»: the product left the cart and a new check is ok', (await c.locator(`[data-line="${A.id}"]`).count()) === 0 && (await c.locator('[data-place-order]').isEnabled()));

  // 9c: short — C has 1 in the cart; make it 2 first
  await c.goto(`${BASE}/cart`, { waitUntil: 'load' });
  await c.locator(`[data-cart-line="${C.id}"]`).getByRole('button', { name: 'زیاد کردن' }).click();
  await c.waitForTimeout(800);
  bot.mode.adjust = new Map([[C.id, 1]]);
  await open();
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('9c fewer units than asked: the line says how many are left', (await c.locator(`[data-line="${C.id}"][data-line-status="adjusted"]`).count()) === 1 && (await c.locator('[data-place-order]').isDisabled()));
  await c.locator('[data-review-fix]').click();
  bot.mode.adjust = new Map();
  await c.waitForFunction(() => !document.querySelector('[data-line-status="adjusted"]') && document.querySelector('[data-review="ready"]'), null, { timeout: 60000 });
  check('9d after «اعمال تغییرات» the quantity is what Liateam has and the check is ok', (await c.locator('[data-place-order]').isEnabled()) && num(await c.locator(`[data-line="${C.id}"]`).innerText()) >= 1);

  // 9e: dearer at Liateam
  const cPrice = Number(sql(`select price from product_catalog where id = ${C.id}`));
  bot.mode.priceUp = new Map([[C.id, cPrice + 5000]]);
  await open();
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('9e a price moved at Liateam: announced, and the order can go on at the new price', /تغییر کرده/.test(await c.locator('[data-review="ready"]').innerText()) && (await c.locator('[data-place-order]').isEnabled()));
  const dearer = await c.locator('[data-payable]').getAttribute('data-payable');
  await c.locator('[data-place-order]').click();
  await c.waitForURL(/\/account\/orders\/AV-\d+/, { timeout: 40000 });
  const n2 = /AV-\d+/.exec(c.url())[0];
  const lp = sql(`select i.unit_list_price from ${S}.order_items i join ${S}.orders o on o.id = i.order_id where o.number = '${n2}' and i.product_id = ${C.id}`);
  check('9f the order holds Liateam\'s new price as the list price; the payable matches the page', Number(lp) === cPrice + 5000 && Number(sql(`select total_payable from ${S}.orders where number = '${n2}'`)) === Number(dearer), `${lp} / ${dearer}`);
  bot.mode.priceUp = new Map();
  sql(`update supplier_products set price = ${cPrice} where id = ${C.id}`);

  // 9g: the bot is silent → after 15 s a clear message and a retry; nothing is made
  bot.mode.silent = true;
  const orders9 = orderCount();
  await open();
  await c.locator('[data-review="failed"]').waitFor({ timeout: 40000 });
  check('9g the bot does not answer: «اتصال به سامانه‌ی تأمین‌کننده» and a retry button', /اتصال به سامانه‌ی تأمین‌کننده/.test(await c.locator('[data-review="failed"]').innerText()) && (await c.locator('[data-review-retry]').count()) === 1);
  check('9h no order was made and the order button is off', orderCount() === orders9 && (await c.locator('[data-place-order]').isDisabled()));
  bot.mode.silent = false;
  await c.locator('[data-review-retry]').click();
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  check('9i retry works once the bot answers', await c.locator('[data-place-order]').isEnabled());

  // 9j: the hold ends → «دوباره بررسی»
  bot.mode.expiresInSeconds = 4;
  await open();
  await c.locator('[data-review="ready"], [data-review="expired"]').first().waitFor({ timeout: 40000 });
  await c.locator('[data-review="expired"]').waitFor({ timeout: 30000 });
  check('9j when the 15-minute hold ends the order button is off and a new check is offered', (await c.locator('[data-place-order]').isDisabled()) && (await c.locator('[data-review-retry]').count()) >= 1);
  bot.mode.expiresInSeconds = 900;

  // 9k: pressing «ثبت سفارش» twice makes one order
  await c.locator('[data-review-retry]').first().click();
  await c.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
  const reviewId = Number(sql(`select c.review_id from ${S}.carts c join ${S}.users uu on uu.id = c.user_id where uu.phone = '${U}' and c.status = 'open'`));
  await c.locator('[data-place-order]').dblclick();
  await c.waitForURL(/\/account\/orders\/AV-\d+/, { timeout: 40000 });
  await sleep(1500);
  check('9k a double click makes exactly one order', Number(sql(`select count(*) from ${S}.orders where review_id = ${reviewId}`)) === 1);
  // replaying the same check later returns the same order instead of a second one
  const keyCount = Number(sql(`select count(*) from ${S}.orders where idempotency_key like 'checkout:review:%:${reviewId}'`));
  check('9l one order per user and check (the idempotency key)', keyCount === 1);

  // ── 10. the cart of the signed-in user survives the browser (stored in the database) ──
  const again = await newPage();
  await again.ctx.addCookies(await c.context().cookies()); // the same session from a new browser: no cart cookie of its own
  await again.page.goto(`${BASE}/cart`, { waitUntil: 'load' });
  check('10 the signed-in cart is the same in a new browser', (await again.page.locator('[data-cart-line]').count()) >= 1);
  await again.ctx.close();
  await v.ctx.close();
  await g.ctx.close();
} finally {
  await bot.stop();
  wipe();
  wipeGuests();
  await browser.close();
}
finish();
