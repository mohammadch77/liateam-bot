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
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (v, 'commission', 5000, 0, 'commission-seed-0001', o) RETURNING id INTO n;
  UPDATE commissions SET status = 'paid', paid_at = now(), wallet_entry_id = n WHERE order_id = o;
  ${mustRaise('check_violation', `UPDATE commissions SET status = 'cancelled' WHERE order_id = o;`)}
  ${mustRaise('check_violation', `INSERT INTO commission_rules (name, kind, value, scope_type, level, hold_days) VALUES ('x', 'percent', 101, 'all', 1, 0);`)}
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

// ── step D: the payment flow's guarantees in the database ──
scenario(
  'payment flow: the method may change only while pending_payment; a gateway reference is one attempt; a repeated callback confirms once',
  `
  UPDATE orders SET payment_method = 'wallet' WHERE id = o; -- still pending_payment: the customer pays another way
  UPDATE orders SET payment_method = 'gateway' WHERE id = o;
  INSERT INTO payments (order_id, method, gateway, amount, idempotency_key) VALUES (o, 'gateway', 'dev', 150000, 'gw:attempt:00000001');
  INSERT INTO payments (order_id, method, gateway, amount, idempotency_key) VALUES (o, 'gateway', 'dev', 150000, 'gw:attempt:00000002');
  UPDATE payments SET gateway_ref = 'DEVAUTH1' WHERE idempotency_key = 'gw:attempt:00000001';
  ${mustRaise('unique_violation', `UPDATE payments SET gateway_ref = 'DEVAUTH1' WHERE idempotency_key = 'gw:attempt:00000002';`)} -- one authority, one attempt
  UPDATE payments SET gateway_ref = 'DEVAUTH2' WHERE idempotency_key = 'gw:attempt:00000002';
  -- the callback: confirmed once (the second UPDATE finds nothing in 'initiated')
  UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE gateway_ref = 'DEVAUTH1' AND status = 'initiated';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'first confirmation touched % rows', n; END IF;
  UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE gateway_ref = 'DEVAUTH1' AND status = 'initiated';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'a repeated callback confirmed again (% rows)', n; END IF;
  -- the other attempt can never be confirmed for the same order
  ${mustRaise('unique_violation', `UPDATE payments SET status = 'confirmed', confirmed_at = now() WHERE gateway_ref = 'DEVAUTH2';`)}
  UPDATE orders SET status = 'queued', paid_at = now() WHERE id = o;
  ${mustRaise('integrity_constraint_violation', `UPDATE orders SET payment_method = 'wallet' WHERE id = o;`)} -- after payment it is fixed
`,
);

scenario(
  'payment flow: paying from the wallet is once per order and cannot overspend; a refund-free needs_review keeps the money',
  `
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'topup', 400000, 0, 'topup-flowtest-1');
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'order_payment', -150000, 0, 'wallet:order:flowtest', o);
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'order_payment', -150000, 0, 'wallet:order:flowtest', o) ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT count(*)::text INTO r FROM wallet_ledger WHERE user_id = u AND kind = 'order_payment';
  IF r <> '1' THEN RAISE EXCEPTION 'the same wallet payment key inserted % rows', r; END IF;
  ${mustRaise('check_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'order_payment', -300000, 0, 'wallet:order:flowtest2', o);`)}
  UPDATE orders SET status = 'queued', paid_at = now() WHERE id = o;
  UPDATE orders SET status = 'needs_review', needs_review_reason = 'price moved' WHERE id = o;
  SELECT balance_after::text INTO r FROM wallet_ledger WHERE user_id = u ORDER BY id DESC LIMIT 1;
  IF r <> '250000' THEN RAISE EXCEPTION 'needs_review moved money: balance %', r; END IF;
`,
);

scenario(
  'payment flow: commissions record their level and hold; the release date is set once; a cancel stops pending ones, not paid ones',
  `
  INSERT INTO affiliate_referrals (buyer_user_id, referrer_user_id, code) VALUES (u, v, 'abcd');
  INSERT INTO commissions (order_id, affiliate_user_id, base_amount, amount, level, hold_days) VALUES (o, v, 100000, 5000, 2, 7);
  SELECT level::text || '/' || hold_days::text || '/' || coalesce(release_at::text, 'null') INTO r FROM commissions WHERE order_id = o;
  IF r <> '2/7/null' THEN RAISE EXCEPTION 'commission columns: %', r; END IF;
  UPDATE commissions SET release_at = now() + interval '7 days' WHERE order_id = o AND release_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'release date not set'; END IF;
  UPDATE commissions SET release_at = now() + interval '9 days' WHERE order_id = o AND release_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'the release date was set twice'; END IF;
  UPDATE commissions SET status = 'cancelled', decided_at = now() WHERE order_id = o AND status IN ('pending', 'approved');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'pending commission not cancelled'; END IF;
  ${mustRaise('check_violation', `UPDATE commissions SET status = 'approved' WHERE order_id = o;`)} -- cancelled is final
  ${mustRaise('check_violation', `INSERT INTO commissions (order_id, affiliate_user_id, base_amount, amount, level, hold_days) VALUES (o, u, 1, 1, 6, 0);`)} -- level 1..5
`,
);

// ── D2: the worker's database guarantees ──
scenario(
  'order tick: a stuck alert is added once per order; the candidates are the paid orders that can still move',
  `
  UPDATE orders SET status = 'queued', paid_at = now() - interval '2 hours' WHERE id = o;
  INSERT INTO order_events (order_id, kind, actor_user_id, data) SELECT o, 'stuck_alert', NULL, '{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = o AND kind = 'stuck_alert');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'first stuck alert not added'; END IF;
  INSERT INTO order_events (order_id, kind, actor_user_id, data) SELECT o, 'stuck_alert', NULL, '{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = o AND kind = 'stuck_alert');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'a second stuck alert was added'; END IF;
  -- the advisory lock is taken and (in the same session) retaken; a different key is independent
  IF NOT pg_try_advisory_xact_lock(hashtextextended('order-advance:' || o::text, 0)) THEN RAISE EXCEPTION 'lock refused'; END IF;
  SELECT count(*) INTO n FROM orders WHERE id = o AND status IN ('queued', 'placing', 'awaiting_payment', 'supplier_paid', 'needs_review');
  IF n <> 1 THEN RAISE EXCEPTION 'a queued order is not a candidate'; END IF;
  UPDATE orders SET status = 'canceled', canceled_at = now() WHERE id = o;
  SELECT count(*) INTO n FROM orders WHERE id = o AND status IN ('queued', 'placing', 'awaiting_payment', 'supplier_paid', 'needs_review');
  IF n <> 0 THEN RAISE EXCEPTION 'a cancelled order is a candidate'; END IF;
`,
);

scenario(
  'customer cancel: shop_cancel_order stops a queued bot order and closes its waiting place job; too late once placing or picked up',
  `
  INSERT INTO public.shop_orders (customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate, items_total, shipping_price, origin)
    VALUES ('A', 'B', '09990000009', 1, 1, '1234567890', 'some address', '1', 1000, 100, 'shop') RETURNING id INTO j;
  INSERT INTO public.order_jobs (kind, payload, requested_by) VALUES ('place', jsonb_build_object('order_id', j), 'shop') RETURNING id INTO n;
  IF NOT public.shop_cancel_order(j) THEN RAISE EXCEPTION 'a queued shop order was not cancelled'; END IF;
  IF (SELECT status FROM public.shop_orders WHERE id = j) <> 'canceled' THEN RAISE EXCEPTION 'bot order not canceled'; END IF;
  IF (SELECT ok OR done_at IS NULL OR picked_at IS NULL FROM public.order_jobs WHERE id = n) THEN RAISE EXCEPTION 'the waiting place job was not closed as failed'; END IF;
  IF public.shop_cancel_order(j) THEN RAISE EXCEPTION 'a cancelled order was cancelled twice'; END IF;

  UPDATE public.shop_orders SET status = 'placing' WHERE id = j;
  UPDATE public.shop_orders SET status = 'queued' WHERE id = j;
  INSERT INTO public.order_jobs (kind, payload, requested_by, picked_at) VALUES ('place', jsonb_build_object('order_id', j), 'shop', now());
  IF public.shop_cancel_order(j) THEN RAISE EXCEPTION 'an order whose place job is running was cancelled'; END IF;

  UPDATE public.shop_orders SET status = 'awaiting_payment' WHERE id = j;
  IF public.shop_cancel_order(j) THEN RAISE EXCEPTION 'a placed order was cancelled'; END IF;

  INSERT INTO public.shop_orders (customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate, items_total, shipping_price, origin)
    VALUES ('A', 'B', '09990000009', 1, 1, '1234567890', 'some address', '1', 1000, 100, 'bot') RETURNING id INTO j;
  IF public.shop_cancel_order(j) THEN RAISE EXCEPTION 'a bot-origin order was cancelled from the shop'; END IF;
  IF public.shop_cancel_order(999999999) THEN RAISE EXCEPTION 'a missing order reported cancelled'; END IF;
`,
);

scenario(
  'customer cancel: the refund row is written once per order (one key), and an order can go queued to canceled but not sent to canceled',
  `
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'topup', 1000, 0, 'topup-cancel-1', NULL);
  UPDATE orders SET status = 'queued', paid_at = now() WHERE id = o;
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'refund', 150000, 0, 'order-cancel-refund:' || o, o);
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'refund', 150000, 0, 'order-cancel-refund:' || o, o) ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'the refund of one cancel was written twice'; END IF;
  IF (SELECT balance_after FROM wallet_ledger WHERE user_id = u ORDER BY id DESC LIMIT 1) <> 151000 THEN RAISE EXCEPTION 'refund balance'; END IF;
  UPDATE orders SET status = 'canceled', canceled_at = now() WHERE id = o;
`,
);

scenario(
  'operator: shop_operator_cancel_order also cancels a placed-and-unpaid order, closes its waiting place job, refuses one being placed, a paid one, a bot-origin one',
  `
  INSERT INTO public.shop_orders (customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate, items_total, shipping_price, origin, status)
    VALUES ('A', 'B', '09990000009', 1, 1, '1234567890', 'some address', '1', 1000, 100, 'shop', 'awaiting_payment') RETURNING id INTO j;
  INSERT INTO public.order_jobs (kind, payload, requested_by) VALUES ('place', jsonb_build_object('order_id', j), 'shop') RETURNING id INTO n;
  IF NOT public.shop_operator_cancel_order(j) THEN RAISE EXCEPTION 'an unpaid placed order was not cancelled by the operator'; END IF;
  IF (SELECT status FROM public.shop_orders WHERE id = j) <> 'canceled' THEN RAISE EXCEPTION 'bot order not canceled'; END IF;
  IF (SELECT ok OR done_at IS NULL FROM public.order_jobs WHERE id = n) THEN RAISE EXCEPTION 'the waiting place job was not closed'; END IF;
  IF public.shop_operator_cancel_order(j) THEN RAISE EXCEPTION 'cancelled twice'; END IF;
  UPDATE public.shop_orders SET status = 'placing' WHERE id = j;
  IF public.shop_operator_cancel_order(j) THEN RAISE EXCEPTION 'an order being placed was cancelled'; END IF;
  UPDATE public.shop_orders SET status = 'supplier_paid' WHERE id = j;
  IF public.shop_operator_cancel_order(j) THEN RAISE EXCEPTION 'a paid order was cancelled'; END IF;
  UPDATE public.shop_orders SET status = 'queued' WHERE id = j;
  INSERT INTO public.order_jobs (kind, payload, requested_by, picked_at) VALUES ('place', jsonb_build_object('order_id', j), 'shop', now());
  IF public.shop_operator_cancel_order(j) THEN RAISE EXCEPTION 'an order whose place job is running was cancelled'; END IF;
  INSERT INTO public.shop_orders (customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate, items_total, shipping_price, origin, status)
    VALUES ('A', 'B', '09990000009', 1, 1, '1234567890', 'some address', '1', 1000, 100, 'bot', 'queued') RETURNING id INTO j;
  IF public.shop_operator_cancel_order(j) THEN RAISE EXCEPTION 'a bot-origin order was cancelled from the shop'; END IF;
`,
);

scenario(
  'operator: shop_order_review_info shows why an order stopped (the two totals and the missing items), only for a shop order in needs_review, and nothing else of the bot event',
  `
  INSERT INTO public.shop_orders (customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate, items_total, shipping_price, origin, status, last_error)
    VALUES ('A', 'B', '09990000009', 1, 1, '1234567890', 'some address', '1', 1000, 100, 'shop', 'needs_review', 'why text') RETURNING id INTO j;
  INSERT INTO public.shop_order_events (order_id, kind, message, data)
    VALUES (j, 'needs_review', 'x', '{"reason":"price","live_total":900000,"expected_total":1000000,"missing":[],"cost":777}'::jsonb);
  INSERT INTO public.shop_order_events (order_id, kind, message, data)
    VALUES (j, 'needs_review', 'y', '{"reason":"unavailable","live_total":850000,"expected_total":1000000,"missing":[541]}'::jsonb);
  SELECT count(*) INTO n FROM public.shop_order_review_info(j) WHERE reason = 'unavailable' AND live_total = 850000 AND expected_total = 1000000 AND missing = '[541]'::jsonb AND why = 'why text';
  IF n <> 1 THEN RAISE EXCEPTION 'the last needs_review event was not described'; END IF;
  UPDATE public.shop_orders SET status = 'queued' WHERE id = j;
  SELECT count(*) INTO n FROM public.shop_order_review_info(j);
  IF n <> 0 THEN RAISE EXCEPTION 'info given for an order that is not in needs_review'; END IF;
  INSERT INTO public.shop_orders (customer_first_name, customer_last_name, customer_mobile, province_id, city_id, postal_code, address, plate, items_total, shipping_price, origin, status)
    VALUES ('A', 'B', '09990000009', 1, 1, '1234567890', 'some address', '1', 1000, 100, 'bot', 'needs_review') RETURNING id INTO j;
  SELECT count(*) INTO n FROM public.shop_order_review_info(j);
  IF n <> 0 THEN RAISE EXCEPTION 'info given for a bot-origin order'; END IF;
`,
);

scenario(
  'operator: a note is append-only; the refund for a lower live price is once per (order, n); a sent order can still get a note but a status never goes back',
  `
  INSERT INTO order_notes (order_id, body) VALUES (o, 'first');
  ${mustRaise('integrity_constraint_violation', `UPDATE order_notes SET body = 'changed' WHERE order_id = o;`)}
  ${mustRaise('integrity_constraint_violation', `DELETE FROM order_notes WHERE order_id = o;`)}
  ${mustRaise('check_violation', `INSERT INTO order_notes (order_id, body) VALUES (o, '');`)}
  ${mustRaise('check_violation', `INSERT INTO order_notes (order_id, body) VALUES (o, repeat('x', 1001));`)}
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'refund', 100000, 0, 'review-diff:' || o || ':1', o);
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (u, 'refund', 100000, 0, 'review-diff:' || o || ':1', o) ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'the price-drop refund was written twice'; END IF;
`,
);

scenario(
  'wallet task: a top-up payment has no order and is confirmed once; withdrawal hold / return rows are once per key, the balance never goes negative, a withdrawal moves only forward',
  `
  INSERT INTO payments (kind, user_id, method, gateway, amount, idempotency_key) VALUES ('wallet_topup', u, 'gateway', 'dev', 100000, 'topup-attempt-00001');
  ${mustRaise('check_violation', `INSERT INTO payments (kind, method, gateway, amount, idempotency_key) VALUES ('wallet_topup', 'gateway', 'dev', 5, 'topup-nouser-00001');`)}
  UPDATE payments SET status = 'confirmed', confirmed_at = now(), gateway_ref = 'TOPUPREF1' WHERE idempotency_key = 'topup-attempt-00001';
  ${mustRaise('check_violation', `UPDATE payments SET status = 'failed' WHERE idempotency_key = 'topup-attempt-00001';`)}
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'topup', 100000, 0, 'topup-payment:1');
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'topup', 100000, 0, 'topup-payment:1') ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'one top-up credited twice'; END IF;
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'commission', 300000, 0, 'comm-seed-000001');
  INSERT INTO withdrawals (user_id, amount, iban, holder_name) VALUES (u, 250000, 'IR062960000000100324200001', 'Test Holder') RETURNING id INTO j;
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, ref) VALUES (u, 'withdrawal', -250000, 0, 'withdrawal-hold:' || j, 'withdrawal:' || j);
  IF (SELECT balance_after FROM wallet_ledger WHERE user_id = u ORDER BY id DESC LIMIT 1) <> 150000 THEN RAISE EXCEPTION 'hold balance'; END IF;
  ${mustRaise('check_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'withdrawal', -150001, 0, 'withdrawal-hold:x1');`)}
  ${mustRaise('check_violation', `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key) VALUES (u, 'withdrawal_return', -5, 0, 'withdrawal-return:bad');`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE withdrawals SET amount = 1 WHERE id = j;`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE withdrawals SET iban = 'IR062960000000100324200002' WHERE id = j;`)}
  ${mustRaise('check_violation', `UPDATE withdrawals SET status = 'paid', decided_at = now() WHERE id = j;`)}
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, ref) VALUES (u, 'withdrawal_return', 250000, 0, 'withdrawal-return:' || j, 'withdrawal:' || j);
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, ref) VALUES (u, 'withdrawal_return', 250000, 0, 'withdrawal-return:' || j, 'withdrawal:' || j) ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'one return credited twice'; END IF;
  UPDATE withdrawals SET status = 'rejected', decided_at = now(), reject_reason = 'test' WHERE id = j;
  IF (SELECT balance_after FROM wallet_ledger WHERE user_id = u ORDER BY id DESC LIMIT 1) <> 400000 THEN RAISE EXCEPTION 'return balance'; END IF;
  ${mustRaise('check_violation', `UPDATE withdrawals SET status = 'paid', decided_at = now(), paid_ref = 'ABC123' WHERE id = j;`)}
  ${mustRaise('check_violation', `INSERT INTO withdrawals (user_id, amount, iban, holder_name) VALUES (u, 5, 'IR12', 'Test Holder');`)}
`,
);

scenario(
  'commission payout: a paid commission needs its wallet row, is credited once (key = the commission) and can no longer be cancelled; a manual-approval flag is kept',
  `
  INSERT INTO commissions (order_id, affiliate_user_id, base_amount, amount, hold_days, release_at, manual_approval, level)
    VALUES (o, v, 100000, 5000, 0, now(), true, 1) RETURNING id INTO j;
  IF NOT (SELECT manual_approval FROM commissions WHERE id = j) THEN RAISE EXCEPTION 'manual flag lost'; END IF;
  UPDATE commissions SET status = 'approved', decided_at = now() WHERE id = j;
  ${mustRaise('check_violation', `UPDATE commissions SET status = 'paid', paid_at = now() WHERE id = j;`)}
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (v, 'commission', 5000, 0, 'commission:' || j, o) RETURNING id INTO n;
  INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id) VALUES (v, 'commission', 5000, 0, 'commission:' || j, o) ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS r = ROW_COUNT;
  IF r::int <> 0 THEN RAISE EXCEPTION 'a commission was credited twice'; END IF;
  UPDATE commissions SET status = 'paid', paid_at = now(), wallet_entry_id = n WHERE id = j;
  IF (SELECT balance_after FROM wallet_ledger WHERE user_id = v ORDER BY id DESC LIMIT 1) <> 5000 THEN RAISE EXCEPTION 'balance after payout'; END IF;
  ${mustRaise('check_violation', `UPDATE commissions SET status = 'cancelled' WHERE id = j;`)}
  ${mustRaise('integrity_constraint_violation', `UPDATE commissions SET amount = 1 WHERE id = j;`)}
`,
);
