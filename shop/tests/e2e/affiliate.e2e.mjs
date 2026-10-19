// «همکاری در فروش» end to end against the running app and the local Docker database: entry points (home band,
// footer, account), guests asked to sign in, an application stored as pending with markup stripped and the entry
// point / IP in the audit log, a second application refused while one is pending, the admin queue (customers get
// 403), approve → role «affiliate» granted by that admin, reject with a reason, no horizontal scroll 390–1920 px.
// Creates three test users and deletes their applications and roles at the end.
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
  sleep,
} from './_harness.mjs';

requireLocalApp();
const one = (q) => sql(q).split('\n')[0] ?? '';
const stamp = String(Date.now()).slice(-6);
const phones = { a: `0914${stamp}1`, b: `0914${stamp}2`, c: `0914${stamp}3` };
const browser = await chromium.launch();
const ctxFor = (n, viewport = { width: 1440, height: 900 }) =>
  browser.newContext({ viewport, extraHTTPHeaders: { 'x-real-ip': `10.88.${n}.${1 + (Date.now() % 200)}` } });
const ids = [];

/** Fills the form; `extra` overrides fields. Browser-side `required` is removed so the server's checks are tested. */
async function fill(page, extra = {}) {
  const v = {
    fullName: 'سارا تست <b>پررنگ</b>',
    province: 'تهران',
    city: 'تهران',
    channelType: 'instagram',
    channelUrl: '@sara.beauty_test',
    followers: '10k-50k',
    description: 'پیج آرایشی دارم <script>alert(1)</script> و محصولات را با ویدیو معرفی می‌کنم.',
    ...extra,
  };
  const form = page.locator('form[aria-labelledby="affiliate-form-title"]');
  await form.evaluate((f) => {
    f.noValidate = true;
  });
  await form.locator('[name=fullName]').fill(v.fullName);
  await form.locator('[name=province]').selectOption(v.province);
  await form.locator('[name=city]').fill(v.city);
  await form.locator('[name=channelType]').selectOption(v.channelType);
  await form.locator('[name=channelUrl]').fill(v.channelUrl);
  await form.locator('[name=followers]').selectOption(v.followers);
  await form.locator('[name=description]').fill(v.description);
  if (!(await form.locator('[name=terms]').isChecked()))
    await form.locator('[name=terms]').check({ force: true });
  return form;
}
/**
 * The form's own error message, waited for until it contains `text` (or 8 s). Scoped to the form on purpose: every
 * Next.js page also has an (empty) <p role="alert"> route announcer, which a page-wide `[role=alert]` can match
 * before React has rendered the form's message — that race made these checks flaky.
 */
const formError = (page, text) =>
  page
    .locator('form[aria-labelledby="affiliate-form-title"] [role=alert]', { hasText: text })
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
const submit = (page, form) =>
  Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 }).catch(() => {}),
    form.getByRole('button', { name: 'ثبت درخواست' }).click(),
  ]);

try {
  // ── 1. entry points ──
  const guestCtx = await ctxFor(1);
  const g = await guestCtx.newPage();
  await g.goto(BASE + '/', { waitUntil: 'load' });
  const band = g.locator('section[aria-labelledby="affiliate-band-title"] a[href="/affiliate?from=home"]');
  check('1a home: «همکاری در فروش» band with its link', (await band.count()) === 1);
  check('1b footer link', (await g.locator('footer a[href="/affiliate?from=footer"]').count()) >= 1);
  await band.scrollIntoViewIfNeeded();
  await shot(g, 'affiliate-home-band-1440.png');

  // ── 2. guests sign in first ──
  await Promise.all([g.waitForURL(/\/affiliate/), band.click()]);
  check(
    '2a guest: «ورود و ثبت درخواست» (back to this page), no form',
    (await g.locator('main a[href^="/login?next=%2Faffiliate%3Ffrom%3Dhome"]').count()) === 1 &&
      (await g.locator('form[aria-labelledby="affiliate-form-title"]').count()) === 0,
  );
  await shot(g, 'affiliate-guest-1440.png', { fullPage: true });
  const anon = await fetch(`${BASE}/affiliate`, { method: 'POST', body: 'x' });
  check(
    '2b no session → nothing stored',
    anon.status >= 400 || !(await anon.text()).includes('در حال بررسی'),
  );

  // ── 3. applicant A ──
  const ctxA = await ctxFor(2, { width: 390, height: 844 });
  const a = await ctxA.newPage();
  await signIn(a, phones.a);
  const userA = one(`select id from ${SCHEMA}.users where phone = '${phones.a}'`);
  ids.push(userA);
  await a.goto(`${BASE}/affiliate?from=home`, { waitUntil: 'load' });
  check(
    '3a signed in: the form, with the account phone (read-only)',
    (await a.locator('form[aria-labelledby="affiliate-form-title"]').count()) === 1 &&
      (await a.locator('input[readonly]').inputValue()).length === 11,
  );
  // a second tab opened before sending: used for the «second application» check
  const a2 = await ctxA.newPage();
  await a2.goto(`${BASE}/affiliate?from=account`, { waitUntil: 'load' });

  let form = await fill(a, { channelUrl: 'javascript:alert(1)' });
  await submit(a, form);
  check(
    '3b bad channel address (javascript:) → message, nothing stored',
    (await formError(a, 'نشانی کانال')) &&
      one(`select count(*) from ${SCHEMA}.affiliate_applications where user_id = ${userA}`) === '0',
  );
  form = await fill(a, { description: 'کوتاه' });
  await submit(a, form);
  check('3c too short description → message', await formError(a, 'حداقل'));
  form = await fill(a);
  await submit(a, form);
  await a.waitForSelector('[role=status]', { timeout: 15000 }).catch(() => {});
  check(
    '3d sent → «درخواستت ثبت شد و در حال بررسی است»',
    (await a.getByText('در حال بررسی است').count()) >= 1,
  );
  await shot(a, 'affiliate-sent-390.png');
  const row = one(
    `select status || '|' || source || '|' || full_name || '|' || channel_url || '|' || phone || '|' || description
       from ${SCHEMA}.affiliate_applications where user_id = ${userA}`,
  );
  const [status, source, fullName, channel, phone, description] = row.split('|');
  check(
    '3e stored as pending, from the home band, with the account phone',
    status === 'pending' && source === 'home' && phone === phones.a,
    row,
  );
  check(
    '3f markup stripped (name, description); handle normalised',
    !/[<>]/.test(fullName + description) && fullName.includes('پررنگ') && channel === '@sara.beauty_test',
    `${fullName} | ${description}`,
  );
  const audit = one(
    `select meta->>'source' || '|' || coalesce(host(ip), '') from ${SCHEMA}.audit_log
      where action = 'affiliate.apply' and actor_user_id = ${userA} order by id desc limit 1`,
  );
  check('3g audit log: entry point and IP', audit.startsWith('home|10.88.2.'), audit);
  await a.reload({ waitUntil: 'load' });
  check(
    '3h back on the page: «در حال بررسی», no form',
    (await a.getByText('در حال بررسی است').count()) >= 1 &&
      (await a.locator('form[aria-labelledby="affiliate-form-title"]').count()) === 0,
  );
  form = await fill(a2, { description: 'یک درخواست دوم با همین حساب برای آزمایش رد شدن.' });
  await submit(a2, form);
  check(
    '3i a second application while one is pending → refused',
    (await formError(a2, 'در حال بررسی')) &&
      one(`select count(*) from ${SCHEMA}.affiliate_applications where user_id = ${userA}`) === '1',
  );
  let res = await a.goto(`${BASE}/admin/affiliates`);
  check('3j customer → /admin/affiliates is 403', res.status() === 403, `status ${res.status()}`);

  // ── 4. applicant C (to be rejected) ──
  const ctxC = await ctxFor(3);
  const c = await ctxC.newPage();
  await signIn(c, phones.c);
  const userC = one(`select id from ${SCHEMA}.users where phone = '${phones.c}'`);
  ids.push(userC);
  await c.goto(`${BASE}/affiliate`, { waitUntil: 'load' });
  form = await fill(c, {
    fullName: 'کاربر سوم',
    channelType: 'store',
    channelUrl: 'example-shop.ir/about',
    followers: 'lt1k',
  });
  await submit(c, form);
  await c.waitForSelector('[role=status]', { timeout: 15000 }).catch(() => {});
  check(
    '4a web address normalised to https://, source direct',
    one(
      `select channel_url || '|' || source from ${SCHEMA}.affiliate_applications where user_id = ${userC}`,
    ) === 'https://example-shop.ir/about|direct',
  );

  // ── 5. admin decides ──
  const ctxB = await ctxFor(4);
  const b = await ctxB.newPage();
  await signIn(b, phones.b);
  const userB = one(`select id from ${SCHEMA}.users where phone = '${phones.b}'`);
  ids.push(userB);
  execSync(`npm run grant-role -- ${phones.b} admin`, { cwd: shopRoot, encoding: 'utf8' });
  res = await b.goto(`${BASE}/admin/affiliates`, { waitUntil: 'load' });
  const idA = one(`select id from ${SCHEMA}.affiliate_applications where user_id = ${userA}`);
  const idC = one(`select id from ${SCHEMA}.affiliate_applications where user_id = ${userC}`);
  const itemA = b.locator(`li[data-application="${idA}"]`);
  check(
    '5a admin: the queue lists the pending applications',
    res.status() === 200 && (await itemA.count()) === 1,
  );
  check(
    '5b admin view shows text only (no injected markup)',
    (await itemA.locator('script, i').count()) === 0 &&
      (await itemA.locator('b').first().textContent()) === 'سارا تست پررنگ',
  );
  await shot(b, 'affiliate-admin-1440.png', { fullPage: true });
  await Promise.all([
    b.waitForURL(/done=approved/),
    itemA.getByRole('button', { name: 'تأیید و ارتقای نقش' }).click(),
  ]);
  const granted = one(
    `select granted_by from ${SCHEMA}.user_roles where user_id = ${userA} and role = 'affiliate'`,
  );
  check(
    '5c approve → status approved, role «affiliate» granted by this admin',
    one(`select status from ${SCHEMA}.affiliate_applications where id = ${idA}`) === 'approved' &&
      granted === userB,
    `granted_by ${granted}`,
  );
  check(
    '5d audit: affiliate.approve + role.grant',
    one(
      `select count(*) from ${SCHEMA}.audit_log where actor_user_id = ${userB}
          and action in ('affiliate.approve', 'role.grant') and created_at > now() - interval '5 minutes'`,
    ) === '2',
  );
  const itemC = b.locator(`li[data-application="${idC}"]`);
  await itemC.locator('input[name=reason]').fill('کانال فروش فعالی پیدا نشد <i>x</i>');
  await Promise.all([
    b.waitForURL(/done=rejected/),
    itemC.getByRole('button', { name: 'رد', exact: true }).click(),
  ]);
  check(
    '5e reject with a reason (cleaned)',
    one(`select status || '|' || reject_reason from ${SCHEMA}.affiliate_applications where id = ${idC}`) ===
      'rejected|کانال فروش فعالی پیدا نشد x',
  );
  check(
    '5f rejected user gets no role',
    one(`select count(*) from ${SCHEMA}.user_roles where user_id = ${userC} and role = 'affiliate'`) === '0',
  );

  // ── 6. what the applicants see now ──
  await a.goto(`${BASE}/affiliate`, { waitUntil: 'load' });
  check(
    '6a approved: «شما فروشنده‌ی همکار هستید»',
    (await a.getByText('فروشنده‌ی همکار هستید').count()) === 1,
  );
  await a.goto(`${BASE}/account`, { waitUntil: 'load' });
  check('6b account shows the role', (await a.getByText('فروشنده‌ی همکار', { exact: true }).count()) === 1);
  await c.goto(`${BASE}/affiliate`, { waitUntil: 'load' });
  check(
    '6c rejected: the reason and the date to try again, no form',
    (await c.getByText('کانال فروش فعالی پیدا نشد').count()) === 1 &&
      (await c.locator('form[aria-labelledby="affiliate-form-title"]').count()) === 0,
  );
  await c.goto(`${BASE}/account`, { waitUntil: 'load' });
  check(
    '6d account page links to «همکاری در فروش»',
    (await c.locator('a[href="/affiliate?from=account"]').count()) === 1,
  );

  // ── 7. widths ──
  const signedInForm = await ctxFor(5);
  const d = await signedInForm.newPage();
  const phoneD = `0914${stamp}4`;
  await signIn(d, phoneD);
  ids.push(one(`select id from ${SCHEMA}.users where phone = '${phoneD}'`));
  for (const width of [390, 768, 1024, 1440, 1920]) {
    for (const [p, path] of [
      [g, '/affiliate'],
      [d, '/affiliate'],
      [g, '/'],
    ]) {
      await p.setViewportSize({ width, height: 900 });
      await p.goto(BASE + path, { waitUntil: 'load' });
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(
        `7 ${width}px ${path}${p === d ? ' (form)' : ''}: no horizontal scroll`,
        over <= 0,
        `overflow ${over}px`,
      );
      if (p === d && (width === 390 || width === 1440))
        await shot(d, `affiliate-form-${width}.png`, { fullPage: true });
      if (p === g && path === '/' && width === 390) {
        await g.locator('section[aria-labelledby="affiliate-band-title"]').scrollIntoViewIfNeeded();
        await sleep(300);
        await shot(g, 'affiliate-home-band-390.png');
      }
    }
  }
} finally {
  if (ids.length) {
    const list = ids.filter(Boolean).join(',');
    sql(`delete from ${SCHEMA}.affiliate_applications where user_id in (${list})`);
    sql(`delete from ${SCHEMA}.user_roles where user_id in (${list}) and role in ('affiliate', 'admin')`);
  }
  await browser.close();
}
finish();
