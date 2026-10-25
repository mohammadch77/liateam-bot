// Prices, the settings page and the search-engine switch (local app + Docker DB; changes one product's numbers and the
// discount mode for the test, then restores them):
//  1. outside production indexing is always blocked: robots.txt «Disallow: /», no sitemap, meta noindex, X-Robots-Tag
//  2. /admin/settings: customer 403; admin sees both discount modes and the indexing switch with the staging note
//  3. mode «liateam» (default): the product shows exactly the discount liateam.ir shows (struck-through list price);
//     mode «excess»: the partner discount above our base margin; back to «liateam»; a product without a Liateam sale
//     shows Liateam's regular price (no automatic «1%»)
//  4. packs: with no discount the pack price is the sum of its products' prices
//  5. no purchase price or margin in the HTML / JSON
import { execSync } from 'node:child_process';
import {
  BASE,
  SCHEMA,
  check,
  chromium,
  finish,
  requireLocalApp,
  shopRoot,
  signIn,
  sql,
  toLatin,
} from './_harness.mjs';

requireLocalApp();
const one = (q) => sql(q).split('\n')[0] ?? '';
const stamp = String(Date.now()).slice(-6);
const phones = { admin: `0915${stamp}1`, customer: `0915${stamp}2` };
const roundUp100 = (n) => Math.ceil(n / 100) * 100;

// a visible product in stock with an English slug and no manual discount on it
const [pid, listPrice, origCost, origPct, slug] = one(
  `select p.id || '|' || p.price || '|' || p.cost_price || '|' || p.consumer_discount_percent || '|' || p.slug_en
     from product_catalog p
    where p.is_sellable and p.price > 100000 and p.missing_since is null and p.stock > 0 and p.slug_en is not null
    order by p.id limit 1`,
).split('|');
const id = Number(pid);
const price = Number(listPrice);
const restore = () => {
  sql(
    `update supplier_products set cost_price = ${origCost}, consumer_discount_percent = ${origPct} where id = ${id}`,
  );
  sql(`delete from ${SCHEMA}.site_settings where key = 'pricing.discount_mode'`);
};

const browser = await chromium.launch();
const ctxFor = (n) =>
  browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'x-real-ip': `10.89.${n}.${1 + (Date.now() % 200)}` },
  });
/** [what the customer pays, the struck-through price or null] from the product page's price label */
async function shownPrice(page) {
  await page.goto(`${BASE}/${slug}`, { waitUntil: 'load' });
  const label =
    (await page
      .locator('main article')
      .getByText(/^قیمت /)
      .first()
      .textContent()) ?? '';
  const [now, before] = label.split('،');
  return [Number(toLatin(now)), before ? Number(toLatin(before)) : null];
}

try {
  // ── 1. search engines ──
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  check(
    '1a robots.txt: Disallow: / (not production)',
    /User-agent: \*\s+Disallow: \/\s*$/m.test(robots),
    robots.trim(),
  );
  check('1b sitemap.xml: 404 while blocked', (await fetch(`${BASE}/sitemap.xml`)).status === 404);
  for (const path of ['/', '/shop']) {
    const r = await fetch(`${BASE}${path}`);
    const html = await r.text();
    check(
      `1c ${path}: X-Robots-Tag noindex, nofollow`,
      r.headers.get('x-robots-tag') === 'noindex, nofollow',
    );
    check(
      `1d ${path}: <meta name="robots" content="noindex, nofollow">`,
      /<meta name="robots" content="noindex, nofollow"\/?>/.test(html),
    );
  }

  // ── 2. the settings page ──
  const cust = await (await ctxFor(1)).newPage();
  await signIn(cust, phones.customer);
  check('2a customer → /admin/settings is 403', (await cust.goto(`${BASE}/admin/settings`)).status() === 403);
  const admin = await (await ctxFor(2)).newPage();
  await signIn(admin, phones.admin);
  execSync(`npm run grant-role -- ${phones.admin} admin`, { cwd: shopRoot, encoding: 'utf8' });
  await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'load' });
  const form = admin.locator('[data-settings-form]');
  check(
    '2b two discount modes, «همان تخفیف لیاتیم» chosen by default',
    (await form.locator('input[name="discountMode"]').count()) === 2 &&
      (await form.locator('input[value="liateam"]').isChecked()),
  );
  check(
    '2c indexing switch on by default, and the staging note',
    (await form.locator('[data-block-indexing]').isChecked()) &&
      (await form.getByText('همیشه از ایندکس شدن جلوگیری می‌شود').count()) === 1,
  );
  const save = async (mode) => {
    await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'load' });
    await form.locator(`input[value="${mode}"]`).check();
    await form.getByRole('button', { name: 'ذخیره‌ی تنظیمات' }).click();
    await admin.getByText('تنظیمات ذخیره شد.').waitFor({ timeout: 20000 });
  };

  // ── 3. prices in both modes ──
  // partner discount 14% (cost 0.86 × price), Liateam's own sale 5%:
  //   liateam → 5% off · excess → 14 − 4 = 10% off · floor = cost + 1% (below both)
  const cost = Math.round(price * 0.86);
  sql(`update supplier_products set cost_price = ${cost}, consumer_discount_percent = 5 where id = ${id}`);
  await save('liateam'); // saving also makes the shop compute prices again
  const [p1, old1] = await shownPrice(admin);
  check(
    '3a mode «liateam»: exactly Liateam’s 5%, the list price struck through',
    p1 === roundUp100(price * 0.95) && old1 === price,
    `${p1} / ${old1} (list ${price})`,
  );
  await save('excess');
  const [p2, old2] = await shownPrice(admin);
  check(
    '3b mode «excess»: the partner discount above the base margin (10%)',
    p2 === roundUp100(price * 0.9) && old2 === price,
    `${p2} / ${old2}`,
  );
  await save('liateam');
  sql(
    `update supplier_products set cost_price = ${Math.round(price * 0.96)}, consumer_discount_percent = 0 where id = ${id}`,
  );
  await save('liateam');
  const [p3, old3] = await shownPrice(admin);
  check(
    '3c no sale on Liateam → Liateam’s regular price, no struck price (no «1%»)',
    p3 === price && old3 === null,
    `${p3} / ${old3}`,
  );
  check(
    '3d the audit log has the setting changes',
    Number(
      one(
        `select count(*) from ${SCHEMA}.audit_log where action = 'setting.update' and entity_id = 'pricing.discount_mode' and created_at > now() - interval '10 minutes'`,
      ),
    ) >= 2,
  );

  // ── 4. a pack without discount costs the sum of its products ──
  const anon = await (await ctxFor(3)).newPage();
  await anon.goto(`${BASE}/packs/skin-routine/oily`, { waitUntil: 'load' });
  const summary = (await anon.locator('main').innerText()).replace(/\s+/g, ' ');
  const total = /جمع قیمت محصولات ([۰-۹٬,]+) تومان/.exec(summary)?.[1];
  const packPrice = /قیمت پک ([۰-۹٬,]+) تومان/.exec(summary)?.[1];
  check(
    '4 pack «پوست چرب» (0%): pack price = sum of the items, no «صرفه‌جویی»',
    !!total && total === packPrice && !/صرفه‌جویی/.test(summary),
    `${total} / ${packPrice}`,
  );

  // ── 5. nothing about cost or margin leaves the server ──
  const pages = [
    await (await fetch(`${BASE}/${slug}`)).text(),
    await (await fetch(`${BASE}/`)).text(),
    await (await fetch(`${BASE}/api/search/suggest?q=${encodeURIComponent('کرم')}`)).text(),
  ].join('\n');
  const found = [
    'cost_price',
    'payable_price',
    'discount_price',
    'consumer_discount',
    'base_margin',
    'extra_retail',
    String(cost),
  ].filter((w) => pages.includes(w));
  check(
    '5 no purchase price, partner discount or margin in HTML / JSON',
    found.length === 0,
    found.join(' '),
  );
} finally {
  restore();
  await browser.close();
}
finish();
