// Packs end to end (local app + Docker DB, after `npm run seed:packs`): a customer gets 403 on /admin/packs; the
// home «روتین پوستی» section with the skin-type chips (switching changes the steps, the section keeps its height);
// the pack page (steps, product links, total struck through, pack price); an admin creates a pack from the panel
// (10% refused with «تخفیف بیش از حد مجاز است», no number; 2% previewed and saved), edits and switches it off;
// switching the collection off hides the home section; no purchase price in any HTML; phones without horizontal
// scroll. Removes its own pack and switches the collection back on.
import { execSync } from 'node:child_process';
import {
  BASE,
  SCHEMA,
  check,
  chromium,
  finish,
  requireLocalApp,
  shopRoot,
  shot,
  signIn,
  sql,
  toLatin,
} from './_harness.mjs';

requireLocalApp();
const one = (q) => sql(q).split('\n')[0] ?? '';
const stamp = String(Date.now()).slice(-6);
const phones = { admin: `0916${stamp}1`, customer: `0916${stamp}2` };
const KEY = `e2e-${stamp}`;
const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
const costs = new Map(
  sql(`select id || ':' || coalesce(cost_price, 0) from product_catalog where is_sellable and price > 0`)
    .split('\n')
    .map((l) => l.split(':').map(Number)),
);
/** purchase prices of these products, and their sum, must appear nowhere (Persian / Latin digits) */
function leaks(text, ids) {
  const nums = ids.map((id) => costs.get(id) ?? 0).filter(Boolean);
  nums.push(nums.reduce((x, y) => x + y, 0));
  const found = [];
  for (const c of nums) for (const f of [String(c), fa(c)]) if (text.includes(f)) found.push(f);
  for (const w of ['cost_price', 'payable_price', 'discount_price']) if (text.includes(w)) found.push(w);
  return found;
}
const collectionId = one(`select id from ${SCHEMA}.pack_collections where slug = 'skin-routine'`);
const packIds = (key) =>
  sql(
    `select i.product_id from ${SCHEMA}.pack_items i join ${SCHEMA}.packs p on p.id = i.pack_id
      where p.variant_key = '${key}' and i.product_id is not null`,
  )
    .split('\n')
    .filter(Boolean)
    .map(Number);
const cleanup = () => {
  sql(`delete from ${SCHEMA}.packs where variant_key like 'e2e-%'`);
  if (collectionId) sql(`update ${SCHEMA}.pack_collections set active = true where id = ${collectionId}`);
};

const browser = await chromium.launch();
const ctxFor = (n, viewport = { width: 1440, height: 900 }) =>
  browser.newContext({ viewport, extraHTTPHeaders: { 'x-real-ip': `10.90.${n}.${1 + (Date.now() % 200)}` } });
const userIds = [];

try {
  check('0 seed: «روتین پوستی» exists (npm run seed:packs)', !!collectionId);
  cleanup();

  // ── 1. a customer cannot reach the panel ──
  const cust = await (await ctxFor(1)).newPage();
  await signIn(cust, phones.customer);
  userIds.push(one(`select id from ${SCHEMA}.users where phone = '${phones.customer}'`));
  const res = await cust.goto(`${BASE}/admin/packs`);
  check('1 customer → /admin/packs is 403', res.status() === 403, `status ${res.status()}`);

  // ── 2. admin ──
  const admin = await (await ctxFor(2)).newPage();
  await signIn(admin, phones.admin);
  userIds.push(one(`select id from ${SCHEMA}.users where phone = '${phones.admin}'`));
  execSync(`npm run grant-role -- ${phones.admin} admin`, { cwd: shopRoot, encoding: 'utf8' });
  // a save through the panel also clears the shop's pack cache (the section reflects the seed right away)
  await admin.goto(`${BASE}/admin/packs?collection=${collectionId}`, { waitUntil: 'load' });
  const colForm = admin.locator('form[aria-labelledby="collection-form-title"]');
  await colForm.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
  await colForm.getByText('مجموعه به‌روز شد.').waitFor({ timeout: 20000 });
  await admin.goto(`${BASE}/admin/packs`, { waitUntil: 'load' });
  check(
    '2a panel lists the seeded packs (چرب، خشک، مختلط، حساس)',
    (await admin.locator('[data-collection="skin-routine"] tr[data-pack]').count()) >= 4,
  );

  // ── 3. home section ──
  const anon = await (await ctxFor(3)).newPage();
  await anon.goto(`${BASE}/`, { waitUntil: 'load' });
  const section = anon.locator('[data-routine]');
  // below the first screen the section is laid out only near the screen (content-visibility: auto)
  await section.scrollIntoViewIfNeeded();
  await anon.waitForFunction(() => document.querySelector('[data-routine]')?.innerText.trim().length > 0);
  const chips = await section.locator('[role=tab]').allInnerTexts();
  check(
    '3a home «روتین پوستی»: skin-type chips from the running packs',
    ['پوست چرب', 'پوست خشک', 'پوست مختلط', 'پوست حساس'].every((t) => chips.includes(t)),
    chips.join(' | '),
  );
  const before = await section.boundingBox();
  const oilyNames = await section.locator('[data-routine-compact] li').allInnerTexts();
  check('3b five steps shown', (await section.locator('[data-routine-compact] li').count()) === 5);
  await section.getByRole('tab', { name: 'پوست خشک' }).click();
  await anon.waitForFunction(() => document.querySelector('[data-routine]')?.dataset.routine === 'dry');
  const after = await section.boundingBox();
  const dryNames = await section.locator('[data-routine-compact] li').allInnerTexts();
  check(
    '3c switching to «پوست خشک» changes the steps, the section keeps its height (no layout shift)',
    JSON.stringify(oilyNames) !== JSON.stringify(dryNames) && Math.abs(before.height - after.height) < 2,
    `${Math.round(before.height)} → ${Math.round(after.height)}`,
  );
  const summary = await section.locator('aside').innerText();
  check(
    '3d summary: pack price or «فعلاً در دسترس نیست», and «مشاهده محصولات»',
    (/تومان/.test(summary) || /فعلاً در دسترس نیست/.test(summary)) && /مشاهده محصولات/.test(summary),
    summary.replace(/\s+/g, ' ').slice(0, 120),
  );
  const homeHtml = await anon.content();
  const allIds = ['oily', 'dry', 'combination', 'sensitive'].flatMap(packIds);
  check(
    '3e home: no purchase price in the HTML',
    !leaks(homeHtml, allIds).length,
    leaks(homeHtml, allIds).join(' '),
  );
  await section.scrollIntoViewIfNeeded();
  await shot(anon, 'packs-home-1440.png');

  // ── 4. pack page ──
  await anon.goto(`${BASE}/packs/skin-routine/oily`, { waitUntil: 'load' });
  const steps = anon.locator('main ol[class*=steps] > li');
  check('4a pack page: five steps in order', (await steps.count()) === 5);
  check(
    '4b each product step links to its product page',
    (await anon
      .locator('main ol[class*=steps] > li a')
      .evaluateAll(
        (as) => as.filter((a) => /^\/[^/]+-\d+$|^\/\d+/.test(a.getAttribute('href') ?? '')).length,
      )) === packIds('oily').length,
  );
  const aside = await anon.locator('aside[aria-label="قیمت پک"]').innerText();
  check(
    '4c summary: items total and the pack price',
    /قیمت پک|فعلاً در دسترس نیست/.test(aside),
    aside.replace(/\s+/g, ' '),
  );
  const packHtml = await anon.content();
  check('4d pack page: no purchase price in the HTML', !leaks(packHtml, packIds('oily')).length);
  check('4e unknown pack → 404', (await anon.goto(`${BASE}/packs/skin-routine/nope`)).status() === 404);
  await anon.goto(`${BASE}/packs/skin-routine/oily`, { waitUntil: 'load' });
  await shot(anon, 'packs-page-1440.png', { fullPage: true });

  // ── 5. create / edit / switch off from the panel ──
  await admin.goto(`${BASE}/admin/packs`, { waitUntil: 'load' });
  const form = admin.locator('form[aria-labelledby="pack-form-title"]');
  const [p1, p2] = packIds('oily');
  await form.locator('input[name=title]').fill(`پک آزمایشی ${stamp}`);
  await form.locator('input[name=variantTitle]').fill('آزمایشی');
  await form.locator('input[name=variantKey]').fill(KEY);
  await form.locator('input[name=discountValue]').fill('10');
  await form.locator('input[name=step0Product]').fill(String(p1));
  await form.locator('input[name=step1Product]').fill(String(p2));
  for (const i of [2, 3, 4]) await form.locator(`input[name=step${i}Label]`).fill('');
  await form.getByRole('button', { name: 'ساخت پک' }).click();
  const refusal = form.locator('[role=alert]');
  await refusal.waitFor({ timeout: 20000 });
  const refusalText = await refusal.innerText();
  check(
    '5a 10% under the purchase price → «تخفیف بیش از حد مجاز است», no number, nothing saved',
    /تخفیف بیش از حد مجاز است/.test(refusalText) &&
      !/[0-9۰-۹]/.test(refusalText) &&
      one(`select count(*) from ${SCHEMA}.packs where variant_key = '${KEY}'`) === '0',
    refusalText,
  );
  // the admin's own decision: 10% with «اجازه‌ی فروش با زیان» → the preview warns, the pack saves at a real 10%
  await form.locator('input[name=allowLoss]').check();
  await form.getByRole('button', { name: 'پیش‌نمایش' }).click();
  await form.locator('[data-at-loss]').waitFor({ timeout: 20000 });
  const lossNote = await form.locator('[data-at-loss]').innerText();
  check(
    '5a2 loss allowed: the preview warns «زیر قیمت خرید», no number',
    /زیر قیمت خرید/.test(lossNote) && !/[0-9۰-۹]/.test(lossNote),
  );
  await form.getByRole('button', { name: 'ساخت پک' }).click();
  await form.getByText('پک ساخته شد.').waitFor({ timeout: 20000 });
  await anon.goto(`${BASE}/packs/skin-routine/${KEY}`, { waitUntil: 'load' });
  check(
    '5a3 loss allowed: the pack sells at a real 10% saving',
    /۱۰٪ صرفه‌جویی/.test(await anon.locator('aside[aria-label="قیمت پک"]').innerText()),
  );
  sql(`delete from ${SCHEMA}.packs where variant_key = '${KEY}'`);
  await admin.goto(`${BASE}/admin/packs`, { waitUntil: 'load' });
  await form.locator('input[name=title]').fill(`پک آزمایشی ${stamp}`);
  await form.locator('input[name=variantTitle]').fill('آزمایشی');
  await form.locator('input[name=variantKey]').fill(KEY);
  await form.locator('input[name=step0Product]').fill(String(p1));
  await form.locator('input[name=step1Product]').fill(String(p2));
  for (const i of [2, 3, 4]) await form.locator(`input[name=step${i}Label]`).fill('');
  await form.locator('input[name=discountValue]').fill('2');
  await form.getByRole('button', { name: 'پیش‌نمایش' }).click();
  await form.locator('[data-preview]').waitFor({ timeout: 20000 });
  const preview = await form.locator('[data-preview]').innerText();
  const p1Price = Number(one(`select price from product_catalog where id = ${p1}`));
  check(
    '5b preview: steps, items total, pack price, saving (no purchase price)',
    /جمع محصولات/.test(preview) &&
      /صرفه‌جویی/.test(preview) &&
      preview.includes(fa(p1Price)) &&
      !leaks(preview, [p1, p2]).length,
    preview.replace(/\s+/g, ' ').slice(0, 160),
  );
  await form.getByRole('button', { name: 'ساخت پک' }).click();
  await form.getByText('پک ساخته شد.').waitFor({ timeout: 20000 });
  const newId = one(`select id from ${SCHEMA}.packs where variant_key = '${KEY}'`);
  check(
    '5c pack saved with 2 steps',
    sql(`select count(*) from ${SCHEMA}.pack_items where pack_id = ${newId}`) === '2',
  );
  await admin.goto(`${BASE}/admin/packs?pack=${newId}`, { waitUntil: 'load' });
  await form.locator('input[name=title]').fill(`پک آزمایشی ویرایش‌شده ${stamp}`);
  await form.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
  await form
    .getByText('پک به‌روز شد.')
    .waitFor({ timeout: 20000 })
    .catch(async (e) => {
      console.log(
        'form says:',
        (await form.locator('[role=alert], [role=status]').allInnerTexts()).join(' | '),
      );
      throw e;
    });
  check(
    '5d edit saved; audit pack.create + pack.update',
    one(`select title from ${SCHEMA}.packs where id = ${newId}`).includes('ویرایش‌شده') &&
      Number(
        one(`select count(*) from ${SCHEMA}.audit_log where entity_type = 'pack' and entity_id = '${newId}'`),
      ) >= 2,
  );
  await anon.goto(`${BASE}/packs/skin-routine/${KEY}`, { waitUntil: 'load' });
  const newAside = await anon.locator('aside[aria-label="قیمت پک"]').innerText();
  check(
    '5e the new pack has its page with a price',
    /قیمت پک/.test(newAside) || /در دسترس نیست/.test(newAside),
  );
  await admin.goto(`${BASE}/admin/packs`, { waitUntil: 'load' });
  await admin.locator(`tr[data-pack="${KEY}"] form:has(input[name=active]) button`).click();
  await admin.waitForURL(/done=off/);
  check(
    '5f switched off from the list',
    one(`select active from ${SCHEMA}.packs where id = ${newId}`) === 'f',
  );
  await shot(admin, 'packs-admin-1440.png', { fullPage: true });

  // ── 6. no running pack → no section ──
  await admin.goto(`${BASE}/admin/packs?collection=${collectionId}`, { waitUntil: 'load' });
  await colForm.locator('input[name=active]').uncheck();
  await colForm.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
  await colForm.getByText('مجموعه به‌روز شد.').waitFor({ timeout: 20000 });
  await anon.goto(`${BASE}/`, { waitUntil: 'load' });
  check(
    '6 collection off → the home section is hidden',
    (await anon.locator('[data-routine]').count()) === 0,
  );
  await admin.goto(`${BASE}/admin/packs?collection=${collectionId}`, { waitUntil: 'load' });
  await colForm.locator('input[name=active]').check();
  await colForm.getByRole('button', { name: 'ذخیره‌ی تغییرات' }).click();
  await colForm.getByText('مجموعه به‌روز شد.').waitFor({ timeout: 20000 });

  // ── 7. phones ──
  const m = await (await ctxFor(4, { width: 390, height: 844 })).newPage();
  for (const path of ['/', '/packs/skin-routine/oily', '/packs/skin-routine/sensitive']) {
    await m.goto(`${BASE}${path}`, { waitUntil: 'load' });
    const over = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`7 390px ${path}: no horizontal scroll`, over <= 0, `${over}px`);
  }
  await m.goto(`${BASE}/`, { waitUntil: 'load' });
  await m.locator('[data-routine]').scrollIntoViewIfNeeded();
  await shot(m, 'packs-home-390.png');
  await m.goto(`${BASE}/packs/skin-routine/oily`, { waitUntil: 'load' });
  await shot(m, 'packs-page-390.png', { fullPage: true });
  void toLatin;
} finally {
  cleanup();
  const list = userIds.filter(Boolean).join(',');
  if (list) sql(`delete from ${SCHEMA}.user_roles where user_id in (${list}) and role = 'admin'`);
  await browser.close();
}
finish();
