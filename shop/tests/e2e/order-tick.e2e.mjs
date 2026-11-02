// The order worker (D2): a paid order moves on WITHOUT its page being opened, when POST /api/internal/tick is called (what the
// systemd timer does every minute through scripts/tick.mjs). Covers: who may call it (no header / wrong header / from outside →
// 404, the right one → 200), pay and close the tab, concurrent ticks that move an order once, waiting for automatic placing,
// the stuck alert (once, an operator SMS once, listed under «نیازمند توجه» in /admin), and the script itself.
// Needs the app started with CRON_SECRET = E2E_CRON_SECRET. Stand-in bot (_responder.mjs), dev payment simulator, invented numbers.
import { execFileSync } from 'node:child_process';
import {
  BASE,
  SCHEMA as S,
  check,
  chromium,
  finish,
  requireLocalApp,
  sleep,
  sql,
  shopRoot,
} from './_harness.mjs';
import { makeAdmin, signIn } from './_admin-login.mjs';
import { chooseAtGateway, enablePayment, setSetting } from './_pay.mjs';
import { seedOrder, seeder } from './_seed-order.mjs';
import { startResponder } from './_responder.mjs';

requireLocalApp();
const CRON = process.env.E2E_CRON_SECRET;
if (!CRON) {
  console.error('set E2E_CRON_SECRET to the CRON_SECRET the app was started with');
  process.exit(2);
}
const stamp = String(Date.now() % 100000).padStart(5, '0');
const { phone, makeUser } = seeder('09995', stamp);
const PHONES = `select phone from ${S}.users where phone like '09995%'`;
const UIDS = `select id from ${S}.users where phone in (${PHONES})`;
const OIDS = `select id from ${S}.orders where user_id in (${UIDS})`;
const OPERATOR = `09995${stamp}8`;
const wipe = () =>
  sql(`set session_replication_role = replica;
    delete from ${S}.commissions where order_id in (${OIDS});
    delete from ${S}.payments where order_id in (${OIDS});
    delete from ${S}.order_events where order_id in (${OIDS});
    delete from ${S}.order_items where order_id in (${OIDS});
    delete from ${S}.orders where user_id in (${UIDS});
    delete from ${S}.sms_log where phone in (${PHONES});
    delete from ${S}.carts where user_id in (${UIDS});
    delete from ${S}.user_roles where user_id in (${UIDS});
    delete from ${S}.sessions where user_id in (${UIDS});
    delete from ${S}.otp_codes where phone in (${PHONES});
    delete from ${S}.audit_log where actor_user_id in (${UIDS}) or (entity_type = 'user' and entity_id in (select id::text from ${S}.users where phone in (${PHONES})));
    delete from ${S}.users where phone in (${PHONES});
    delete from ${S}.site_settings where key = 'system.tick_cursor';`);

const orderRow = (n) =>
  sql(
    `select status || '|' || coalesce(bot_order_id::text, '') from ${S}.orders where number = '${n}'`,
  ).split('|');
const events = (n) =>
  sql(
    `select coalesce(string_agg(kind, ',' order by id), '') from ${S}.order_events where order_id = (select id from ${S}.orders where number = '${n}')`,
  );
const count = (n, kind) =>
  Number(
    sql(
      `select count(*) from ${S}.order_events where kind = '${kind}' and order_id = (select id from ${S}.orders where number = '${n}')`,
    ),
  );
const tick = (headers = {}) =>
  fetch(`${BASE}/api/internal/tick`, { method: 'POST', headers: { 'x-cron-secret': CRON, ...headers } });
const ticksUntil = async (ok, ms = 40000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await (await tick()).json();
    if (ok()) return true;
    await sleep(1000);
  }
  return false;
};

const bot = startResponder();
const restorePay = await enablePayment({
  'orders.auto_place_enabled': true,
  'orders.auto_place_hours': { from: '00:00', to: '00:00' },
  'orders.stuck_alert_minutes': 5,
  'orders.operator_phone': OPERATOR,
  'sms.provider': 'dev',
  'sms.operator_template': 'op-alert',
});
const browser = await chromium.launch();
try {
  wipe();

  // ── 1. who may call the tick ──
  const no = await fetch(`${BASE}/api/internal/tick`, { method: 'POST' });
  const wrong = await tick({ 'x-cron-secret': 'x'.repeat(CRON.length) });
  const outside = await tick({ 'x-real-ip': '203.0.113.9' });
  const chain = await tick({ 'x-forwarded-for': '127.0.0.1, 198.51.100.4' });
  check('1a without the header: 404 (not 401: it does not reveal itself)', no.status === 404);
  check('1b a wrong secret: 404', wrong.status === 404);
  check(
    "1c the right secret but from outside (nginx stamps the visitor's address): 404",
    outside.status === 404 && chain.status === 404,
  );
  const ok = await tick();
  const okBody = await ok.json();
  check(
    '1d the right secret from the machine: 200 with a report and no secret in it',
    ok.status === 200 &&
      okBody.ok === true &&
      typeof okBody.tried === 'number' &&
      !JSON.stringify(okBody).includes(CRON),
  );
  check(
    '1e the other methods are not an entry either',
    (await fetch(`${BASE}/api/internal/tick`, { headers: { 'x-cron-secret': CRON } })).status !== 200,
  );

  // ── 2. pay, close the tab without looking at the order: the tick carries it on ──
  const buyer = makeUser(1);
  bot.mode.silent = true; // the bot is slow: when the customer comes back the order is paid but not yet registered
  const o1 = seedOrder(buyer);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, buyer.phone);
  await page.goto(`${BASE}/account/orders/${o1.number}`);
  await page.locator('[data-pay-submit]').click();
  await chooseAtGateway(page, 'success');
  await ctx.close(); // the tab is closed; the order page is never opened
  const before = orderRow(o1.number);
  check(
    '2a paid and waiting: queued, the bot was asked to create it but has not answered',
    before[0] === 'queued' &&
      before[1] === '' &&
      count(o1.number, 'bot_create_requested') === 1 &&
      count(o1.number, 'bot_linked') === 0,
    `${before.join(' ')} | ${events(o1.number)}`,
  );
  bot.mode.silent = false;
  const moved = await ticksUntil(() => orderRow(o1.number)[0] === 'awaiting_payment');
  check(
    '2b with nobody looking, ticks linked the bot order, placed it and followed the bot to awaiting_payment',
    moved,
    `${orderRow(o1.number).join(' ')} | ${events(o1.number)}`,
  );
  check(
    '2c each step happened once',
    count(o1.number, 'bot_linked') === 1 &&
      count(o1.number, 'place_requested') === 1 &&
      count(o1.number, 'bot_create_requested') === 1,
  );
  const idle = await (await tick()).json();
  check(
    '2d a tick with nothing left to do changes nothing for this order',
    orderRow(o1.number)[0] === 'awaiting_payment' &&
      count(o1.number, 'place_requested') === 1 &&
      idle.failed === 0,
  );

  // ── 3. ticks at the same moment move an order once ──
  bot.mode.silent = true;
  const o2 = seedOrder(buyer);
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await signIn(p2, buyer.phone);
  await p2.goto(`${BASE}/account/orders/${o2.number}`);
  await p2.locator('[data-pay-submit]').click();
  await chooseAtGateway(p2, 'success');
  await c2.close();
  bot.mode.silent = false;
  await sleep(1500); // the bot has answered the create job by now
  const bodies = await Promise.all([tick(), tick(), tick(), tick()].map((r) => r.then((x) => x.json())));
  await ticksUntil(() => orderRow(o2.number)[0] === 'awaiting_payment');
  check(
    '3a four ticks at once: every one answered, none failed',
    bodies.every((b) => b.ok === true && b.failed === 0),
    JSON.stringify(bodies.map((b) => [b.advanced, b.skipped, b.busy])),
  );
  check(
    '3b the order was linked and placed exactly once',
    count(o2.number, 'bot_linked') === 1 &&
      count(o2.number, 'place_requested') === 1 &&
      count(o2.number, 'bot_create_requested') === 1,
    events(o2.number),
  );
  check(
    '3c only one bot order exists for it',
    Number(sql(`select count(*) from public.shop_orders where id = ${Number(orderRow(o2.number)[1])}`)) === 1,
  );

  // ── 4. automatic placing off: registered, but not placed until it is on and inside the hours ──
  await setSetting('orders.auto_place_enabled', false);
  const o3 = seedOrder(buyer);
  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await signIn(p3, buyer.phone);
  await p3.goto(`${BASE}/account/orders/${o3.number}`);
  await p3.locator('[data-pay-submit]').click();
  await chooseAtGateway(p3, 'success');
  await c3.close();
  await ticksUntil(() => count(o3.number, 'waiting_for_placement') === 1);
  const placeJobs = () =>
    Number(
      sql(
        `select count(*) from public.order_jobs where kind = 'place' and (payload->>'order_id')::int = ${Number(orderRow(o3.number)[1] || 0)}`,
      ),
    );
  check(
    '4a auto-place off: the tick registers it but does not place it; it waits (queued)',
    orderRow(o3.number)[0] === 'queued' &&
      orderRow(o3.number)[1] !== '' &&
      placeJobs() === 0 &&
      count(o3.number, 'waiting_for_placement') === 1,
    events(o3.number),
  );
  await tick();
  await tick();
  check(
    '4b more ticks keep it waiting and add nothing',
    placeJobs() === 0 &&
      count(o3.number, 'waiting_for_placement') === 1 &&
      count(o3.number, 'place_requested') === 0,
  );
  await setSetting('orders.auto_place_enabled', true);
  check(
    '4c once auto-place is on (inside the hours) the next ticks place it',
    await ticksUntil(() => orderRow(o3.number)[0] === 'awaiting_payment'),
    orderRow(o3.number)[0],
  );

  // ── 5. the stuck alert: once, one operator SMS, listed for the admin ──
  const adminPhone = phone(9);
  makeAdmin(adminPhone);
  const o4 = seedOrder(buyer);
  bot.mode.silent = true;
  sql(
    `set search_path = ${S}, public; update ${S}.orders set status = 'queued', paid_at = now() - interval '2 hours' where id = ${o4.id}`,
  );
  const smsOp = () =>
    Number(
      sql(
        `select count(*) from ${S}.sms_log where phone = '${OPERATOR}' and purpose = 'other' and status = 'sent'`,
      ),
    );
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ap = await actx.newPage();
  await signIn(ap, adminPhone, '/admin');
  check(
    "5a before any tick the admin's «نیازمند توجه» does not list it",
    (await ap.locator(`[data-attention-order="${o4.number}"]`).count()) === 0,
  );
  await tick();
  await tick();
  await tick();
  check(
    '5b waiting longer than the setting: ONE stuck_alert event, however many ticks',
    count(o4.number, 'stuck_alert') === 1,
    events(o4.number),
  );
  check(
    '5c ONE operator SMS for it (purpose «other»), and the event says it was sent',
    smsOp() === 1 && count(o4.number, 'stuck_sms') === 1,
    String(smsOp()),
  );
  await ap.goto(`${BASE}/admin`);
  check(
    '5d the admin sees it under «نیازمند توجه», by number only',
    (await ap.locator(`[data-attention] [data-attention-order="${o4.number}"]`).count()) === 1 &&
      !(await ap.locator('[data-attention]').innerText()).includes(buyer.phone),
  );
  bot.mode.silent = false;
  await ticksUntil(() => orderRow(o4.number)[0] === 'awaiting_payment');
  await ap.goto(`${BASE}/admin`);
  check(
    '5e once it moves on, it is no longer listed, and no second alert or SMS was made',
    (await ap.locator(`[data-attention-order="${o4.number}"]`).count()) === 0 &&
      count(o4.number, 'stuck_alert') === 1 &&
      smsOp() === 1,
  );
  await actx.close();

  // ── 6. the script the timer runs ──
  const run = (secret) => {
    try {
      const out = execFileSync(process.execPath, ['scripts/tick.mjs'], {
        cwd: shopRoot,
        encoding: 'utf8',
        env: { ...process.env, PORT: new URL(BASE).port, CRON_SECRET: secret },
      });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  const good = run(CRON);
  check(
    '6a scripts/tick.mjs with the right secret: exit 0 and a one-line report',
    good.code === 0 && /\[tick\] tried \d+, advanced \d+/.test(good.out),
    good.out.trim(),
  );
  const bad = run('z'.repeat(CRON.length));
  check(
    '6b with a wrong secret: exit 1, says 404, and prints no secret',
    bad.code === 1 && /404/.test(bad.out) && !bad.out.includes(CRON),
  );
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
