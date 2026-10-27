// Phase-2 database layer (migrations 011-016, deploy/shop-db-roles-016-orders.sql) against the local Docker Postgres:
// the wallet cannot go negative and repeats insert once, a payment is confirmed once, the status machine and the
// snapshots are enforced by triggers, and the shop role reaches the bot's order queue only through the five functions —
// no cost, no DELETE, no DDL. Every scenario runs inside a transaction that is rolled back; the data is invented.
// Needs `npm run db:up` in the root and `npm run migrate:up` (local). Run: npm run test:unit
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const psql = (user, sql) =>
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      path.join(root, 'docker-compose.yml'),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      user,
      '-d',
      'lia_sync',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

let ready = true;
try {
  ready =
    psql(
      'lia',
      `SELECT to_regclass('shop_staging.wallet_ledger') IS NOT NULL AND to_regproc('public.shop_enqueue_place') IS NOT NULL`,
    ) === 't';
} catch {
  ready = false;
}
const scenario = (name, body) =>
  test(
    name,
    { skip: ready ? false : 'local Postgres with migrations 011-016 and shop-db-roles-016 is not available' },
    () => {
      // one transaction, always rolled back; plpgsql asserts by raising, so a failed assertion fails psql
      psql(
        'lia',
        `BEGIN; SET LOCAL search_path = shop_staging, public; DO $t$ DECLARE u bigint; v bigint; o bigint; n bigint; r text; j int; BEGIN ${setup} ${body} END $t$; ROLLBACK;`,
      );
    },
  );

// a user, a second user and an order of 100 000 + shipping 50 000 (fake data)
const setup = `
  INSERT INTO users (phone) VALUES ('09990000001') RETURNING id INTO u;
  INSERT INTO users (phone) VALUES ('09990000002') RETURNING id INTO v;
  INSERT INTO orders (user_id, idempotency_key, payment_method, recipient_name, recipient_phone, province, city, province_id, city_id,
                      postal_code, line, plate, items_total, shipping_supplier_price, shipping_charged)
  VALUES (u, 'idem-key-00000001', 'gateway', 'Test User', '09120000003', 'P', 'C', 1, 1, '1234567890', 'some address line', '1',
          100000, 50000, 50000) RETURNING id INTO o;
`;
/** plpgsql: run `stmt`, fail the scenario if it did NOT raise `sqlstate` */
const mustRaise = (sqlstate, stmt) =>
  `BEGIN ${stmt} RAISE EXCEPTION 'EXPECTED ${sqlstate} BUT NOTHING WAS RAISED'; EXCEPTION WHEN ${sqlstate} THEN NULL; END;`;

test(
  'wallet: balance follows the ledger, never goes negative, a repeated key inserts once, rows cannot be edited',
  { skip: !ready },
  () => {
    psql(
      'lia',
      `BEGIN; SET LOCAL search_path = shop_staging, public; DO $t$ DECLARE u bigint; o bigint; b bigint; c int; BEGIN
    ${setup.replace(/INSERT INTO users \(phone\) VALUES \('09990000002'\) RETURNING id INTO v;/, '')}
    INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'topup', 100000, 0, 'topup-0000001');
    INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'order_payment', -30000, 0, 'pay-00000001', o);
    SELECT balance_after INTO b FROM wallet_ledger WHERE user_id = u ORDER BY id DESC LIMIT 1;
    IF b <> 70000 THEN RAISE EXCEPTION 'balance %, expected 70000', b; END IF;
    ${mustRaise('check_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'withdrawal', -70001, 0, 'wd-000000001');`)}
    INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'topup', 5000, 0, 'topup-0000001') ON CONFLICT (idempotency_key) DO NOTHING;
    SELECT count(*) INTO c FROM wallet_ledger WHERE user_id = u;
    IF c <> 2 THEN RAISE EXCEPTION 'a repeated idempotency key inserted again (% rows)', c; END IF;
    ${mustRaise('check_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'topup', -5, 0, 'bad-sign-0001');`)}
    ${mustRaise('check_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'refund', 5, 0, 'refund-noord1');`)}
    ${mustRaise('integrity_constraint_violation', `UPDATE wallet_ledger SET amount = 1 WHERE user_id = u;`)}
    ${mustRaise('integrity_constraint_violation', `DELETE FROM wallet_ledger WHERE user_id = u;`)}
    ${mustRaise('unique_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'order_payment', -1, 0, 'pay-00000002', o);`)}
  END $t$; ROLLBACK;`,
    );
  },
);

scenario(
  'payments: one confirmation per order; a confirmed payment is final',
  `
  INSERT INTO payments (order_id, method, gateway, amount, idempotency_key) VALUES (o, 'gateway', 'zarinpal', 150000, 'pay-attempt-0001');
  INSERT INTO payments (order_id, method, gateway, amount, idempotency_key) VALUES (o, 'gateway', 'zarinpal', 150000, 'pay-attempt-0002');
  UPDATE payments SET status = 'confirmed', confirmed_at = now(), gateway_ref = 'A1' WHERE idempotency_key = 'pay-attempt-0001';
  ${mustRaise('unique_violation', `UPDATE payments SET status = 'confirmed', confirmed_at = now(), gateway_ref = 'A2' WHERE idempotency_key = 'pay-attempt-0002';`)}
  ${mustRaise('check_violation', `UPDATE payments SET status = 'failed' WHERE idempotency_key = 'pay-attempt-0001';`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE payments SET amount = 1 WHERE idempotency_key = 'pay-attempt-0002';`)}
  ${mustRaise('unique_violation', `INSERT INTO payments (order_id, method, gateway, amount, idempotency_key) VALUES (o, 'gateway', 'zarinpal', 5, 'pay-attempt-0001');`)}
  ${mustRaise('check_violation', `INSERT INTO payments (order_id, method, amount, status, idempotency_key) VALUES (o, 'wallet', 5, 'confirmed', 'pay-attempt-0003');`)}
`,
);

scenario(
  'orders: the status machine, the paid-before-queue rule, the frozen amounts and the shipping split',
  `
  SELECT shipping_absorbed::text || '/' || total_payable::text INTO r FROM orders WHERE id = o;
  IF r <> '0/150000' THEN RAISE EXCEPTION 'generated columns: %', r; END IF;
  ${mustRaise('check_violation', `UPDATE orders SET status = 'sent', paid_at = now() WHERE id = o;`)}
  ${mustRaise('check_violation', `UPDATE orders SET status = 'queued' WHERE id = o;`)} -- not paid yet
  UPDATE orders SET status = 'queued', paid_at = now() WHERE id = o;
  UPDATE orders SET status = 'placing' WHERE id = o;
  UPDATE orders SET status = 'needs_review', needs_review_reason = 'price moved' WHERE id = o;
  UPDATE orders SET status = 'placing' WHERE id = o;
  UPDATE orders SET status = 'awaiting_payment', bot_order_id = 7 WHERE id = o;
  ${mustRaise('integrity_constraint_violation', `UPDATE orders SET bot_order_id = 8 WHERE id = o;`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE orders SET items_total = 1 WHERE id = o;`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE orders SET shipping_charged = 0 WHERE id = o;`)}
  ${mustRaise('check_violation', `UPDATE orders SET status = 'placing' WHERE id = o;`)}
  UPDATE orders SET status = 'supplier_paid' WHERE id = o;
  UPDATE orders SET status = 'sent' WHERE id = o;
  ${mustRaise('check_violation', `UPDATE orders SET status = 'queued' WHERE id = o;`)} -- final
  ${mustRaise('check_violation', `UPDATE orders SET refunded_total = 150001 WHERE id = o;`)}
  ${mustRaise('unique_violation', `INSERT INTO orders (user_id, idempotency_key, payment_method, recipient_name, recipient_phone, province, city, province_id, city_id, postal_code, line, plate, items_total, shipping_supplier_price, shipping_charged) VALUES (u, 'idem-key-00000001', 'gateway', 'T U', '09120000003', 'P', 'C', 1, 1, '1234567890', 'some address line', '1', 1, 1, 1);`)}
  ${mustRaise('check_violation', `INSERT INTO orders (user_id, idempotency_key, payment_method, recipient_name, recipient_phone, province, city, province_id, city_id, postal_code, line, plate, items_total, shipping_supplier_price, shipping_charged) VALUES (u, 'idem-key-00000002', 'gateway', 'T U', '09120000003', 'P', 'C', 1, 1, '1234567890', 'some address line', '1', 1, 100, 101);`)} -- charged above Liateam's price
`,
);

scenario(
  'order lines: the price snapshot is frozen, never above the list price, refunds stay within the line; events are append-only',
  `
  INSERT INTO order_items (order_id, product_id, name, quantity, unit_list_price, unit_price, discount_percent, pricing_mode)
    VALUES (o, 541, 'Item', 2, 60000, 50000, 16.67, 'partner');
  SELECT line_total::text INTO r FROM order_items WHERE order_id = o;
  IF r <> '100000' THEN RAISE EXCEPTION 'line_total %', r; END IF;
  ${mustRaise('check_violation', `INSERT INTO order_items (order_id, product_id, name, quantity, unit_list_price, unit_price) VALUES (o, 542, 'X', 1, 100, 101);`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE order_items SET unit_price = 1 WHERE order_id = o;`)}
  ${mustRaise('check_violation', `UPDATE order_items SET refunded_quantity = 3 WHERE order_id = o;`)}
  UPDATE order_items SET refunded_quantity = 1, refunded_amount = 50000, bot_status = 'refunded' WHERE order_id = o;
  ${mustRaise('integrity_constraint_violation', `UPDATE order_items SET bot_status = 'ok' WHERE order_id = o;`)}
  ${mustRaise('unique_violation', `INSERT INTO order_items (order_id, product_id, name, quantity, unit_list_price, unit_price) VALUES (o, 541, 'Dup', 1, 10, 10);`)}
  INSERT INTO order_events (order_id, kind, data) VALUES (o, 'created', '{"a":1}');
  ${mustRaise('integrity_constraint_violation', `UPDATE order_events SET kind = 'changed' WHERE order_id = o;`)}
  ${mustRaise('integrity_constraint_violation', `DELETE FROM order_events WHERE order_id = o;`)}
`,
);

scenario(
  'carts: an owner is a user or a guest token; one open cart per user; quantities stay in range',
  `
  ${mustRaise('check_violation', `INSERT INTO carts (user_id, guest_token_hash) VALUES (u, repeat('a', 40));`)}
  ${mustRaise('check_violation', `INSERT INTO carts DEFAULT VALUES;`)}
  INSERT INTO carts (user_id) VALUES (u) RETURNING id INTO n;
  ${mustRaise('unique_violation', `INSERT INTO carts (user_id) VALUES (u);`)}
  INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (n, 541, 2);
  ${mustRaise('check_violation', `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (n, 542, 51);`)}
  ${mustRaise('unique_violation', `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (n, 541, 1);`)}
  UPDATE carts SET status = 'ordered' WHERE id = n;
  INSERT INTO carts (user_id) VALUES (u); -- a new open cart after the old one became an order
`,
);

scenario(
  'affiliate: one referrer per buyer, no self-referral, commissions: one per order and a fixed path; the rules start empty',
  `
  IF (SELECT count(*) FROM commission_rules) <> 0 THEN RAISE EXCEPTION 'commission_rules must start empty'; END IF;
  INSERT INTO affiliate_referrals (buyer_user_id, referrer_user_id, code) VALUES (u, v, 'abcd');
  ${mustRaise('unique_violation', `INSERT INTO affiliate_referrals (buyer_user_id, referrer_user_id, code) VALUES (u, v, 'abcd');`)}
  ${mustRaise('check_violation', `INSERT INTO affiliate_referrals (buyer_user_id, referrer_user_id, code) VALUES (v, v, 'abcd');`)}
  INSERT INTO commissions (order_id, affiliate_user_id, base_amount, amount) VALUES (o, v, 100000, 5000);
  ${mustRaise('unique_violation', `INSERT INTO commissions (order_id, affiliate_user_id, base_amount, amount) VALUES (o, v, 100000, 1);`)}
  ${mustRaise('check_violation', `UPDATE commissions SET status = 'paid', paid_at = now() WHERE order_id = o;`)} -- pending cannot jump to paid
  ${mustRaise('integrity_constraint_violation', `UPDATE commissions SET amount = 9 WHERE order_id = o;`)}
  UPDATE commissions SET status = 'approved' WHERE order_id = o;
  UPDATE commissions SET status = 'paid', paid_at = now() WHERE order_id = o;
  ${mustRaise('check_violation', `UPDATE commissions SET status = 'cancelled' WHERE order_id = o;`)}
  ${mustRaise('check_violation', `INSERT INTO commission_rules (name, kind, value) VALUES ('x', 'percent', 101);`)}
`,
);

scenario(
  'settings: the starting values of the order flow are stored',
  `
  SELECT string_agg(key || '=' || value::text, ',' ORDER BY key) INTO r FROM site_settings
   WHERE key IN ('orders.price_tolerance_toman', 'orders.auto_place_enabled', 'shipping.free_enabled', 'shipping.free_from_toman');
  IF r <> 'orders.auto_place_enabled=false,orders.price_tolerance_toman=10,shipping.free_enabled=false,shipping.free_from_toman=999000' THEN
    RAISE EXCEPTION 'settings: %', r;
  END IF;
`,
);

// ── the shop role ──
const asShop = (body) => `SET LOCAL ROLE lia_shop_staging; ${body}`;

scenario(
  "shop role: the bot's queue is reachable only through the five functions; the shop sees the review answer, not other jobs",
  asShop(`
  SELECT public.shop_enqueue_review(5, '[{"product_id": 541, "quantity": 2}]'::jsonb) INTO j;
  RESET ROLE;
  IF (SELECT requested_by || '/' || kind FROM public.order_jobs WHERE id = j) <> 'shop/review' THEN RAISE EXCEPTION 'review job'; END IF;
  -- the bot would answer; an answer to a job of someone else must stay invisible
  UPDATE public.order_jobs SET done_at = now(), ok = true, result = '{"ok": true, "total": 123}' WHERE id = j;
  INSERT INTO public.order_jobs (kind, payload, requested_by, done_at, ok, result) VALUES ('review', '{}', 'telegram:x', now(), true, '{"secret": 1}') RETURNING id INTO n;
  INSERT INTO public.order_jobs (kind, payload, requested_by, done_at, ok, result) VALUES ('place', '{}', 'shop', now(), false, '{"error": "cost 5"}') RETURNING id INTO o;
  SET LOCAL ROLE lia_shop_staging;
  IF (SELECT (result->>'total') FROM public.shop_review_result(j)) <> '123' THEN RAISE EXCEPTION 'own review answer'; END IF;
  IF EXISTS (SELECT 1 FROM public.shop_review_result(n::int)) THEN RAISE EXCEPTION 'a job of the dashboard must not be readable'; END IF;
  IF EXISTS (SELECT 1 FROM public.shop_review_result(o::int)) OR EXISTS (SELECT 1 FROM public.shop_create_result(o::int)) THEN RAISE EXCEPTION 'place results must not be readable'; END IF;
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_review(5, '[]'::jsonb);`)}
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_review(5, '[{"product_id": 1, "quantity": 99}]'::jsonb);`)}
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_review(0, '[{"product_id": 1, "quantity": 1}]'::jsonb);`)}
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_create(n::int, '{}'::jsonb, '{}'::jsonb);`)} -- a review of the dashboard cannot be turned into an order
`),
);

scenario(
  'shop role: create is once per review (always the gateway, never the bot wallet); place only for a waiting shop order, once',
  asShop(`
  SELECT public.shop_enqueue_review(5, '[{"product_id": 541, "quantity": 1}]'::jsonb) INTO j;
  SELECT public.shop_enqueue_create(j, '{"first_name":"A","last_name":"B","mobile":"09120000003"}'::jsonb,
         '{"province_id":1,"city_id":5,"postal_code":"1234567890","address":"some address","plate":"1"}'::jsonb) INTO n;
  IF public.shop_enqueue_create(j, '{"first_name":"A","last_name":"B","mobile":"09120000003"}'::jsonb,
         '{"province_id":1,"city_id":5,"postal_code":"1234567890","address":"some address","plate":"1"}'::jsonb) <> n THEN
    RAISE EXCEPTION 'a second create for the same review must return the same job';
  END IF;
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_create(j, '{"first_name":"A","last_name":"B","mobile":"123"}'::jsonb, '{}'::jsonb);`)}
  RESET ROLE;
  IF (SELECT payload->>'payment' FROM public.order_jobs WHERE id = n) <> 'gateway' THEN RAISE EXCEPTION 'payment must be the gateway'; END IF;
  -- a shop order waiting in the bot's queue, and one from the dashboard
  INSERT INTO public.shop_orders (status, customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate,
                                  items_total, shipping_price, origin)
    VALUES ('queued', 'A', 'B', '09120000003', 1, 5, '1234567890', 'x', '1', 100, 10, 'shop') RETURNING id INTO o;
  INSERT INTO public.shop_orders (status, customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate,
                                  items_total, shipping_price, origin)
    VALUES ('queued', 'A', 'B', '09120000003', 1, 5, '1234567890', 'x', '1', 100, 10, 'bot') RETURNING id INTO v;
  SET LOCAL ROLE lia_shop_staging;
  SELECT public.shop_enqueue_place(o::int, 110, 25) INTO j;
  IF j IS NULL THEN RAISE EXCEPTION 'place was not queued'; END IF;
  IF public.shop_enqueue_place(o::int, 110, 25) IS NOT NULL THEN RAISE EXCEPTION 'a second waiting place job must not be queued'; END IF;
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_place(v::int, 110);`)} -- not a shop order
  ${mustRaise('invalid_parameter_value', `PERFORM public.shop_enqueue_place(o::int, NULL);`)}
  RESET ROLE;
  IF (SELECT payload::text FROM public.order_jobs WHERE id = j) <> '{"max_diff": 25, "order_id": ' || o || ', "expected_total": 110}' THEN
    RAISE EXCEPTION 'place payload: %', (SELECT payload::text FROM public.order_jobs WHERE id = j);
  END IF;
`),
);

scenario(
  "shop role: no cost, no profit text, no queue tables, no DELETE, no DDL; only the granted columns of the bot's orders",
  asShop(`
  ${mustRaise('insufficient_privilege', `PERFORM cost_price FROM public.product_catalog LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM 1 FROM public.order_jobs LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM 1 FROM public.review_holds LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM 1 FROM public.wallet_ledger LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM 1 FROM public.shop_order_events LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM liateam_total FROM public.shop_orders LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM dry_run_result FROM public.shop_orders LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM last_error FROM public.shop_orders LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `PERFORM unit_cost FROM public.shop_order_items LIMIT 1;`)}
  ${mustRaise('insufficient_privilege', `UPDATE public.shop_orders SET status = 'sent';`)}
  ${mustRaise('insufficient_privilege', `INSERT INTO public.order_jobs (kind, payload, requested_by) VALUES ('place', '{}', 'shop');`)}
  ${mustRaise('insufficient_privilege', `DELETE FROM shop_staging.orders;`)}
  ${mustRaise('insufficient_privilege', `DELETE FROM shop_staging.wallet_ledger;`)}
  ${mustRaise('insufficient_privilege', `DELETE FROM shop_staging.cart_items;`)}
  ${mustRaise('insufficient_privilege', `CREATE TABLE shop_staging.evil (a int);`)}
  ${mustRaise('insufficient_privilege', `ALTER TABLE shop_staging.orders ADD COLUMN cost bigint;`)}
  ${mustRaise('insufficient_privilege', `DROP TABLE shop_staging.orders;`)}
  ${mustRaise('insufficient_privilege', `TRUNCATE shop_staging.order_events;`)}
  PERFORM id, status, items_total, shipping_price, refunded_total, liateam_order_code, payment_url, placed_at, supplier_paid_at, sent_at, tracking
    FROM public.shop_orders LIMIT 1;
  PERFORM order_id, product_id, quantity, status FROM public.shop_order_items LIMIT 1;
`),
);
