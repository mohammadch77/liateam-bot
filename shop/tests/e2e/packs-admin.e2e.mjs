// «پک‌های کاربردی» managed from the panel (local app + Docker DB):
//  1. a new collection with its own title and subtitle (created in /admin/packs) and a free-named tab becomes its own
//     section of the home page: the title as typed (no suffix), the subtitle, the tab label
//  2. ↑ / ↓ move the collection in the panel's order, and the home follows
//  3. the steps of a pack can be reordered with ↑ / ↓ in the pack form (names and products swap)
//  4. a collection switched off leaves the home (nothing is deleted)
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
} from './_harness.mjs';

requireLocalApp();
const one = (q) => sql(q).split('\n')[0] ?? '';
const stamp = String(Date.now()).slice(-6);
const phone = `0917${stamp}7`;
const SLUG = `e2e-${stamp}`;
const TITLE = `پک آزمایشی ${stamp}`;
const SUB = `زیرعنوان آزمایشی ${stamp}`;
const TAB = `مراقبت مو ${stamp}`;
const cleanup = () => {
  sql(
    `delete from ${SCHEMA}.pack_items where pack_id in (select p.id from ${SCHEMA}.packs p join ${SCHEMA}.pack_collections c on c.id = p.collection_id where c.slug = '${SLUG}')`,
  );
  sql(
    `delete from ${SCHEMA}.packs where collection_id in (select id from ${SCHEMA}.pack_collections where slug = '${SLUG}')`,
  );
  sql(`delete from ${SCHEMA}.pack_collections where slug = '${SLUG}'`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: { 'x-real-ip': `10.85.1.${1 + (Date.now() % 200)}` },
});
const admin = await ctx.newPage();
/** the home's pack sections: [title, subtitle] in page order */
const sections = async () => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${BASE}/`, { waitUntil: 'load' });
  await anon
    .locator('[data-routine]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  const out = await anon
    .locator('[data-routine]')
    .evaluateAll((els) =>
      els.map((e) => [
        e.querySelector('h2')?.textContent?.trim(),
        e.querySelector('h2 + p')?.textContent?.trim(),
        e.querySelector('[role=tab]')?.textContent?.trim(),
      ]),
    );
  await anon.close();
  return out;
};

try {
  cleanup();
  await signIn(admin, phone);
  execSync(`npm run grant-role -- ${phone} admin`, { cwd: shopRoot, encoding: 'utf8' });

  // ── 1. create the collection in the panel ──
  await admin.goto(`${BASE}/admin/packs`, { waitUntil: 'load' });
  const form = admin.locator('form[aria-labelledby="collection-form-title"]');
  await form.locator('input[name=title]').fill(TITLE);
  await form.locator('input[name=subtitle]').fill(SUB);
  await form.locator('input[name=slug]').fill(SLUG);
  await form.locator('input[name=variantLabel]').fill('نیاز');
  await form.getByRole('button', { name: 'ساخت مجموعه' }).click();
  await form.getByText('مجموعه ساخته شد.').waitFor({ timeout: 20000 });
  check(
    '1a the collection was created with its subtitle',
    one(`select subtitle from ${SCHEMA}.pack_collections where slug = '${SLUG}'`) === SUB,
  );

  // a pack (tab) with a free name and two steps (one «soon»), inserted directly
  const cid = one(`select id from ${SCHEMA}.pack_collections where slug = '${SLUG}'`);
  const pid = one(
    `insert into ${SCHEMA}.packs (collection_id, variant_key, variant_title, title, discount_kind, discount_value, active)
     values (${cid}, 'hair', '${TAB}', 'پک مراقبت مو', 'percent', 0, true) returning id`,
  );
  const prod = sql(
    `select id from product_catalog where is_sellable and price > 0 and stock > 0 and missing_since is null order by id limit 2`,
  ).split('\n');
  sql(
    `insert into ${SCHEMA}.pack_items (pack_id, step_label, product_id, sort_order) values (${pid}, 'شامپو', ${prod[0]}, 0), (${pid}, 'ماسک', ${prod[1]}, 1)`,
  );
  let s = await sections();
  const mine = s.find((x) => x[0] === TITLE);
  check(
    '1b home: a section with the typed title (no suffix), the subtitle and the free tab name',
    !!mine && mine[1] === SUB && mine[2] === TAB,
    JSON.stringify(s),
  );
  const countBefore = s.length;

  // ── 2. move ↑ until it is first; the home follows ──
  await admin.goto(`${BASE}/admin/packs`, { waitUntil: 'load' });
  for (let i = 0; i < 6; i++) {
    const order = await admin
      .locator('[data-collection]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-collection')));
    if (order[0] === SLUG) break;
    await admin.locator(`[data-collection="${SLUG}"] [data-move=collection] form:first-child button`).click();
    await admin.waitForURL(/done=moved/, { timeout: 20000 });
  }
  s = await sections();
  check(
    '2a ↑ in the panel puts the collection first on the home',
    s[0]?.[0] === TITLE,
    JSON.stringify(s.map((x) => x[0])),
  );
  await admin.locator(`[data-collection="${SLUG}"] [data-move=collection] form:nth-child(2) button`).click();
  await admin.waitForURL(/done=moved/, { timeout: 20000 });
  s = await sections();
  check(
    '2b ↓ moves it back one place',
    s[0]?.[0] !== TITLE && s.some((x) => x[0] === TITLE),
    JSON.stringify(s.map((x) => x[0])),
  );

  // ── 3. reorder the steps in the pack form ──
  await admin.goto(`${BASE}/admin/packs?pack=${pid}`, { waitUntil: 'load' });
  const row0 = admin.locator('[data-step-row]').nth(0);
  const label0 = await row0.locator('input').nth(0).inputValue();
  await row0.getByRole('button', { name: /پایین بردن/ }).click();
  const after0 = await admin.locator('[data-step-row]').nth(0).locator('input').nth(0).inputValue();
  const after1 = await admin.locator('[data-step-row]').nth(1).locator('input').nth(0).inputValue();
  check(
    '3 ↓ on step 1 swaps it with step 2 (name and product)',
    label0 === 'شامپو' && after0 === 'ماسک' && after1 === 'شامپو',
    `${after0} / ${after1}`,
  );

  // ── 4. switched off: gone from the home, still in the database ──
  sql(`update ${SCHEMA}.pack_collections set active = false where slug = '${SLUG}'`);
  s = await sections();
  check(
    '4 a collection switched off leaves the home (the rows stay)',
    s.length === countBefore - 1 &&
      Number(one(`select count(*) from ${SCHEMA}.pack_collections where slug = '${SLUG}'`)) === 1,
    String(s.length),
  );
} finally {
  cleanup();
  sql(
    `delete from ${SCHEMA}.user_roles where user_id = (select id from ${SCHEMA}.users where phone = '${phone}') and role = 'admin'`,
  );
  await browser.close();
}
finish();
