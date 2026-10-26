// Prices, the settings page and the search-engine switch (local app + Docker DB; changes one product's numbers and the
// discount mode for the test, then restores them):
//  1. outside production indexing is always blocked: robots.txt «Disallow: /», no sitemap, meta noindex, X-Robots-Tag
//  2. /admin/settings: customer 403; admin sees both discount modes and the indexing switch with the staging note
//  3. mode «partner» (default): the partner discount as the price (struck-through list price); «consumer» and
//     «beyond_base» as before; a product without a Liateam sale in «consumer»
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
    '2b three discount modes (partner, consumer, beyond_base), one chosen (partner unless DEFAULT_DISCOUNT_MODE says otherwise)',
    (await form.locator('input[name="discountMode"]').count()) === 3 &&
      (await form.locator('input[name="discountMode"]:checked').count()) === 1,
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

  // ── 3. prices in the three modes ──
  // Liateam's partner discount 14% (cost 0.86 × price), Liateam's own sale 5%:
  //   partner → the whole base (14% off, down to cost) · consumer → 5% · beyond_base → 14 − 4 = 10%
  const cost = Math.round(price * 0.86);
  sql(`update supplier_products set cost_price = ${cost}, consumer_discount_percent = 5 where id = ${id}`);
  await save('partner'); // saving also makes the shop compute prices again
  const [p1, old1] = await shownPrice(admin);
  check(
    '3a mode «partner»: Liateam’s own 5% sale (bigger than the 4% base) replaces the base; the list price is struck through',
    p1 === roundUp100(price * 0.95) && old1 === price,
    `${p1} / ${old1} (list ${price})`,
  );
  await save('consumer');
  const [p2, old2] = await shownPrice(admin);
  check(
    '3b mode «consumer»: exactly Liateam’s own 5%',
    p2 === roundUp100(price * 0.95) && old2 === price,
    `${p2} / ${old2}`,
  );
  await save('beyond_base');
  const [p4, old4] = await shownPrice(admin);
  check(
    '3c mode «beyond_base»: the partner discount above the base margin (10%)',
    p4 === roundUp100(price * 0.9) && old4 === price,
    `${p4} / ${old4}`,
  );
  // no sale, a real 14% partner discount: capped at the announced 4%
  sql(`update supplier_products set cost_price = ${cost}, consumer_discount_percent = 0 where id = ${id}`);
  await save('partner');
  const [pc, oldc] = await shownPrice(admin);
  check(
    '3a2 partner: a real 14% partner discount is capped at 4% (OUR_BASE_MARGIN_PERCENT)',
    pc === roundUp100(price * 0.96) && oldc === price,
    `${pc} / ${oldc}`,
  );
  // a product with the ordinary 4% partner discount and no sale: partner → 4% off; consumer → no discount at all
  sql(
    `update supplier_products set cost_price = ${Math.round(price * 0.96)}, consumer_discount_percent = 0 where id = ${id}`,
  );
  await save('partner');
  const [p5, old5] = await shownPrice(admin);
  check(
    '3d partner: the ordinary 4% (≈ 4% off, struck list price) — never a «1%»',
    old5 === price && p5 === roundUp100(price * 0.96),
    `${p5} / ${old5}`,
  );
  await save('consumer');
  const [p3, old3] = await shownPrice(admin);
  check(
    '3e consumer, no sale on Liateam → Liateam’s regular price, no struck price',
    p3 === price && old3 === null,
    `${p3} / ${old3}`,
  );
  // «تخفیفات ویژه» lists only discounts beyond the base: this product (base 4% only) is not on /offers
  await save('partner');
  const offers = await (await fetch(`${BASE}/offers`)).text();
  check('3f the base-only product is not listed under «تخفیفات ویژه»', !offers.includes(`${slug}"`));
  check(
    '3d the audit log has the setting changes',
    Number(
      one(
        `select count(*) from ${SCHEMA}.audit_log where action = 'setting.update' and entity_id = 'pricing.discount_mode' and created_at > now() - interval '10 minutes'`,
      ),
    ) >= 2,
  );

  // ── 4. a pack without a pack discount: its price is the sum of its items' final prices (the partner base), and the
  //       struck-through total is the sum of their list prices ──
  const anon = await (await ctxFor(3)).newPage();
  await anon.goto(`${BASE}/packs/skin-routine/oily`, { waitUntil: 'load' });
  const summary = (await anon.locator('main').innerText()).replace(/\s+/g, ' ');
  const total = Number(toLatin(/جمع قیمت محصولات ([۰-۹٬,]+) تومان/.exec(summary)?.[1] ?? ''));
  const packPrice = Number(toLatin(/قیمت پک ([۰-۹٬,]+) تومان/.exec(summary)?.[1] ?? ''));
  const stepPrices = await anon
    .locator('main ol[class*=steps] > li')
    .evaluateAll((lis) => lis.map((li) => /([۰-۹٬]+)\s*تومان/.exec(li.innerText)?.[1]).filter(Boolean));
  const sum = stepPrices.map((t) => Number(toLatin(t))).reduce((n, x) => n + x, 0);
  check(
    '4 pack «پوست چرب» (no pack discount): pack price = sum of the items’ prices, struck total = their list prices',
    packPrice === sum && total > packPrice,
    `${total} / ${packPrice} / items ${sum}`,
  );

  // ── 4b. every pack is available in partner mode — numbers, not «فعلاً در دسترس نیست» — also when an item's
  //        purchase price is unknown (a pack without a discount is the sum of its items) ──
  await save('partner');
  const packKeys = sql(
    `select variant_key from ${SCHEMA}.packs p join ${SCHEMA}.pack_collections c on c.id = p.collection_id where c.slug = 'skin-routine' and p.active order by p.sort_order, p.id`,
  )
    .split('\n')
    .filter(Boolean);
  const oilyItem = Number(
    one(
      `select i.product_id from ${SCHEMA}.pack_items i join ${SCHEMA}.packs p on p.id = i.pack_id where p.variant_key = 'oily' and i.product_id is not null order by i.sort_order limit 1 offset 2`,
    ),
  );
  const oilyCost = one(`select cost_price from supplier_products where id = ${oilyItem}`);
  sql(`update supplier_products set cost_price = 0 where id = ${oilyItem}`); // unknown purchase price
  await admin.goto(`${BASE}/admin/settings`, { waitUntil: 'load' }); // (a panel request clears the app's caches)
  try {
    for (const key of packKeys) {
      await anon.goto(`${BASE}/packs/skin-routine/${key}`, { waitUntil: 'load' });
      const txt = (await anon.locator('main').innerText()).replace(/\s+/g, ' ');
      const t = Number(toLatin(/جمع قیمت محصولات ([۰-۹٬,]+) تومان/.exec(txt)?.[1] ?? ''));
      const pp = Number(toLatin(/قیمت پک ([۰-۹٬,]+) تومان/.exec(txt)?.[1] ?? ''));
      check(
        `4b pack «${key}» in partner mode: the pack price and the struck-through total are numbers (≠ «در دسترس نیست»)`,
        t > 0 && pp > 0 && t >= pp && !/فعلاً در دسترس نیست/.test(txt),
        `${t} / ${pp}`,
      );
    }
    await anon.goto(`${BASE}/`, { waitUntil: 'load' });
    await anon.locator('[data-routine]').first().scrollIntoViewIfNeeded();
    for (const tab of await anon.locator('[data-routine] [role=tab]').all()) {
      await tab.click();
      const sum = (await anon.locator('[data-routine] aside').first().innerText()).replace(/\s+/g, ' ');
      check(
        `4c home tab «${(await tab.innerText()).trim()}»: a pack price, not «فعلاً در دسترس نیست»`,
        /تومان/.test(sum) && !/فعلاً در دسترس نیست/.test(sum),
        sum.slice(0, 90),
      );
    }
  } finally {
    sql(`update supplier_products set cost_price = ${oilyCost} where id = ${oilyItem}`);
  }

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
