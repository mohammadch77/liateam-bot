// Seeding for the payment tests: a customer, and a pending_payment order with its good, fresh review job as the checkout leaves
// it (so the stand-in bot can turn it into its queued order). Invented data, straight into the local database.
import { SCHEMA as S, sql } from './_harness.mjs';

export const SHIPPING = 187_900;

export const products = sql(
  `select string_agg(id || ':' || price, ',' order by id) from (select id, price from product_catalog where is_sellable and price > 0 and missing_since is null and stock >= 6 order by id limit 2) x`,
)
  .split(',')
  .map((r) => r.split(':').map(Number));
if (products.length < 2) {
  console.error('need 2 in-stock products in the local DB');
  process.exit(2);
}

/** `new Seeder('09993', stamp)`: numbers are prefix + 5-digit stamp + a digit */
export function seeder(prefix, stamp) {
  const phone = (n) => `${prefix}${stamp}${n}`;
  const makeUser = (n) => {
    const p = phone(n);
    const id = sql(`insert into ${S}.users (phone) values ('${p}') returning id`).split('\n')[0];
    sql(`insert into ${S}.user_roles (user_id, role) values (${id}, 'customer')`);
    return { id, phone: p };
  };
  return { phone, makeUser, seedOrder };
}

/** a pending_payment order with its (good, fresh) review job, as the checkout leaves it */
export function seedOrder(user, { qty = 2, expiresInSec = 900 } = {}) {
  const lines = products.map(([id, price]) => ({ id, price, qty }));
  const goods = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const names = Object.fromEntries(
    sql(
      `select string_agg(id || '~' || name, '|') from product_catalog where id in (${lines.map((l) => l.id).join(',')})`,
    )
      .split('|')
      .map((r) => r.split('~')),
  );
  const result = {
    ok: true,
    city_id: 5,
    items: lines.map((l) => ({
      product_id: l.id,
      name: names[l.id],
      requested: l.qty,
      quantity: l.qty,
      status: 'ok',
      unit_price: l.price,
      line_total: l.price * l.qty,
      price_changed: null,
      limited: false,
    })),
    alternatives: {},
    shipping: { price: SHIPPING, title: 'پست' },
    items_total: goods,
    total: goods + SHIPPING,
    urgent: false,
    expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };
  const job = Number(
    sql(`insert into public.order_jobs (kind, payload, requested_by, picked_at, done_at, ok, result)
         values ('review', $j$${JSON.stringify({ city_id: 5, items: lines.map((l) => ({ product_id: l.id, quantity: l.qty })) })}$j$::jsonb, 'shop', now(), now(), true, $j$${JSON.stringify(result)}$j$::jsonb)
         returning id`).split('\n')[0],
  );
  const itemsTotal = lines.reduce((t, l) => t + (l.price - 1000) * l.qty, 0);
  const row =
    sql(`insert into ${S}.orders (user_id, idempotency_key, payment_method, recipient_name, recipient_phone, province, city, province_id, city_id,
        postal_code, line, plate, items_total, discount_total, shipping_supplier_price, shipping_charged, review_id, live_checked_at, live_ok, live_total, live_expires_at)
      values (${user.id}, 'seed:${user.id}:${job}:${Date.now()}', 'gateway', 'Test Buyer', '${user.phone}', 'P', 'C', 1, 5, '1234567890', 'some address line', '12',
              ${itemsTotal}, ${goods - itemsTotal}, ${SHIPPING}, ${SHIPPING}, ${job}, now(), true, ${goods + SHIPPING}, now() + interval '${expiresInSec} seconds')
      returning id || '|' || number || '|' || total_payable`);
  const [id, number, payable] = row.split('\n')[0].split('|');
  for (const l of lines)
    sql(
      `insert into ${S}.order_items (order_id, product_id, name, quantity, unit_list_price, unit_price) values (${id}, ${l.id}, $j$${names[l.id]}$j$, ${l.qty}, ${l.price}, ${l.price - 1000})`,
    );
  return { id, number, payable: Number(payable), itemsTotal, job, liveTotal: goods + SHIPPING };
}
