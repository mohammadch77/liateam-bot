// Touch test of the cart and the checkout on WebKit phones (iPhone 8 and iPhone 13 profiles): adding from a card and from
// the product page's bottom bar by TAP, the cart page (no sideways scroll, 44px controls, the bottom tab bar's badge), the
// sign-in that merges the guest cart, the address form with the phone's own pickers, the live check, and «ثبت سفارش».
// The sync bot is replaced by the responder (_responder.mjs). Test users use invented numbers, new for every run.
import { BASE, SCHEMA as S, check, devices, finish, requireLocalApp, signIn, sql, toLatin, webkit } from './_harness.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const num = (t) => Number(toLatin(t));
const LIKE = `select phone from ${S}.users where phone like '09992%'`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.order_events where order_id in (select id from ${S}.orders where user_id in (select id from ${S}.users where phone in (${LIKE})));
    delete from ${S}.order_items where order_id in (select id from ${S}.orders where user_id in (select id from ${S}.users where phone in (${LIKE})));
    delete from ${S}.orders where user_id in (select id from ${S}.users where phone in (${LIKE}));
    delete from ${S}.cart_items where cart_id in (select id from ${S}.carts where user_id in (select id from ${S}.users where phone in (${LIKE})) or (guest_token_hash is not null and created_at > now() - interval '2 hours'));
    delete from ${S}.carts where user_id in (select id from ${S}.users where phone in (${LIKE})) or (guest_token_hash is not null and created_at > now() - interval '2 hours');
    delete from ${S}.addresses where user_id in (select id from ${S}.users where phone in (${LIKE}));
    delete from public.order_jobs where requested_by = 'shop' and done_at is null;`);

const product = sql(
  `select id || ':' || slug_en from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 and slug_en is not null order by id limit 1`,
).split(':');
const [productId, slug] = [Number(product[0]), product[1]];

const bot = startResponder();
const browser = await webkit.launch();
let run = 0;
try {
  wipe();
  for (const name of ['iPhone 8', 'iPhone 13']) {
    const stamp = String(Date.now() % 100_000).padStart(5, '0');
    const phone = `09992${String(++run)}${stamp}0`.slice(0, 11);
    const ctx = await browser.newContext({ ...devices[name] });
    const p = await ctx.newPage();
    const overflow = async () => (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1;

    // a guest taps «افزودن» on a card, then on the product page's bottom bar
    await p.goto(`${BASE}/shop`, { waitUntil: 'load' });
    await p.locator('main article [data-cart-add]').first().tap();
    await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 20000 });
    const tabBadge = await p.locator('nav[aria-label="ناوبری اصلی"] [data-cart-count]').first().getAttribute('data-cart-count');
    check(`1a ${name}: a tap on a card adds it; the tab bar's cart shows 1`, tabBadge === '1', String(tabBadge));
    await p.goto(`${BASE}/shop/product/${slug}`, { waitUntil: 'load' });
    await p.locator('[data-product-buy="sticky"]').tap();
    await p.locator('[data-cart-toast="ok"]').waitFor({ timeout: 20000 });
    check(`1b ${name}: the bottom bar's add button works by tap`, true);

    // the cart page
    await p.goto(`${BASE}/cart`, { waitUntil: 'load' });
    check(`2a ${name}: the cart page has no sideways scroll`, await overflow());
    const small = await p.evaluate(() =>
      [...document.querySelectorAll('[data-cart-line] button, [data-cart-summary] a')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.height < 43.5 || r.width < 43.5);
      }).length,
    );
    check(`2b ${name}: every cart control is at least 44px`, small === 0, `${small} too small`);
    const first = p.locator('[data-cart-line]').first();
    const q0 = num(await first.locator('[data-line-qty]').innerText());
    await first.getByRole('button', { name: 'زیاد کردن' }).tap();
    await p.waitForFunction((q) => Number(document.querySelector('[data-cart-line] [data-line-qty]')?.textContent?.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) === q, q0 + 1, { timeout: 15000 });
    check(`2c ${name}: + by tap raises the quantity`, true);
    check(`2d ${name}: the summary and «ادامه و ثبت سفارش» are on the page`, (await p.locator('[data-cart-summary]').count()) === 1 && (await p.getByRole('link', { name: 'ادامه و ثبت سفارش' }).isVisible()));

    // sign in (the guest cart joins the account), then the checkout
    await signIn(p, phone);
    await p.goto(`${BASE}/cart`, { waitUntil: 'load' });
    check(`3a ${name}: after sign-in the cart is still there (merged)`, (await p.locator('[data-cart-line]').count()) >= 2);
    await p.goto(`${BASE}/checkout`, { waitUntil: 'load' });
    await p.locator('[data-address-form]').waitFor();
    check(`3b ${name}: the checkout has no sideways scroll`, await overflow());
    await p.getByLabel('نام و نام خانوادگی گیرنده').fill('آزمون تست');
    await p.getByLabel('استان').selectOption({ label: 'اصفهان' });
    await p.waitForFunction(() => document.querySelectorAll('select[name="city"] option').length > 1, null, { timeout: 30000 });
    await p.getByLabel('شهر').selectOption({ label: 'اصفهان' });
    await p.getByLabel('کد پستی').fill('8123456789');
    await p.getByLabel('پلاک').fill('7');
    await p.getByLabel('نشانی کامل').fill('خیابان آزمون');
    const tooSmall = await p.evaluate(() =>
      [...document.querySelectorAll('[data-address-form] input, [data-address-form] select, [data-address-form] button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).length,
    );
    check(`3c ${name}: the address fields and buttons are at least 44px high`, tooSmall === 0, `${tooSmall} too small`);
    await p.getByRole('button', { name: 'ذخیره و ادامه' }).tap();
    await p.locator('[data-review="ready"]').waitFor({ timeout: 40000 });
    check(`3d ${name}: the live check answered; the totals show`, (await p.locator('[data-payable]').count()) === 1);
    check(`3e ${name}: the checkout still has no sideways scroll`, await overflow());
    await p.locator('[data-place-order]').scrollIntoViewIfNeeded();
    const box = await p.locator('[data-place-order]').boundingBox();
    check(`3f ${name}: «ثبت سفارش» is reachable and 44px+`, !!box && box.height >= 43.5 && box.width <= p.viewportSize().width);
    await p.locator('[data-place-order]').tap();
    await p.waitForURL(/\/account\/orders\/AV-\d+/, { timeout: 40000 });
    check(`4a ${name}: the order is made (pending_payment) and its page has no sideways scroll`, (await overflow()) && /پرداخت در مرحله‌ی بعد فعال می‌شود/.test(await p.locator('main').innerText()));
    check(`4b ${name}: the order is in the database for this user only`, Number(sql(`select count(*) from ${S}.orders o join ${S}.users u on u.id = o.user_id where u.phone = '${phone}' and o.status = 'pending_payment'`)) === 1);
    await ctx.close();
    void productId;
  }
} finally {
  await bot.stop();
  wipe();
  await browser.close();
}
finish();
