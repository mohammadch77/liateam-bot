// Orders service: the only process that talks to Liateam about orders.
//   npm run orders   (systemd: liateam-orders.service)
//
// Jobs arrive in order_jobs (LISTEN/NOTIFY, plus a slow poll as a safety net):
//   review  - live stock/price check of a basket for the "order review" step (seconds, read-only at Liateam)
//   create  - the customer paid: turn a fresh review into a queued shop order
//   place   - an admin pressed "place & pay": re-check, create the address and the order at Liateam,
//             hand back the payment link. Liateam cancels unpaid orders after ~20 min, so an order
//             is only placed at the moment an admin is ready to pay; until then it waits in the queue.
// A tracker follows placed orders (paid / canceled / sent) and removes the customer's address afterwards.
//
// Safety: ordersDryRun (default true) runs every step except the final POST /order/orders.
// Customer data never goes to the logs.
import pg from 'pg';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { openPool, applySettings, setStatus } from './db.mjs';
import { inQuietHours } from './schedule.mjs';
import { AuthError } from './auth.mjs';
import * as L from './liateam-api.mjs';

const REVIEW_TTL_MS = 15 * 60_000;      // a review is valid this long for creating an order
const REMIND_AFTER_MS = 2 * 3600_000;   // queued this long -> remind admins (outside quiet hours)
const MAX_ITEMS = 20, MAX_QTY = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => sleep(600 + Math.random() * 900); // between Liateam calls of one placement

const pool = await openPool();
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const toman = (rial) => `${Math.round(Number(rial) / 10).toLocaleString('fa-IR')} تومان`;

class InputError extends Error {}
const int = (v, name, min = 1, max = 10 ** 9) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`${name} نامعتبر است`);
  return n;
};
const text = (v, name, max = 300) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > max) throw new InputError(`${name} نامعتبر است`);
  return s;
};

async function event(orderId, kind, message, data = null) {
  await q('INSERT INTO shop_order_events (order_id, kind, message, data) VALUES ($1,$2,$3,$4)', [orderId, kind, message, data]);
}

/**
 * Quantities already promised inside our system: queued orders (paid, not yet at Liateam) plus
 * live review holds of other customers. Shown stock = Liateam stock minus these.
 */
async function reserved(exceptReviewId = 0) {
  const rows = await q(
    `SELECT product_id, sum(n)::int AS n FROM (
       SELECT i.product_id, i.quantity AS n FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id
        WHERE o.status IN ('queued','placing') AND i.status = 'ok'
       UNION ALL
       SELECT product_id, quantity FROM review_holds WHERE expires_at > now() AND review_id <> $1
     ) x GROUP BY product_id`, [exceptReviewId]);
  return new Map(rows.map((r) => [r.product_id, r.n]));
}

/** Post-express option for a city, or null if Liateam cannot ship there. */
async function shippingFor(cityId, items) {
  const options = await L.logisticDeliveries(cityId, items);
  return options.find((o) => o.type === 'post_express') ?? options[0] ?? null;
}

/** A live price that differs from our catalog: apply it from now on and tell the admins. */
async function applyPriceChange(p, live, source) {
  await q(`UPDATE supplier_products SET price = $2, cost_price = $3, updated_at = now() WHERE id = $1`, [p.id, live.price, live.cost_price]);
  await q('INSERT INTO supplier_price_history (product_id, price, cost_price, stock) VALUES ($1,$2,$3,$4)', [p.id, live.price, live.cost_price, live.inventory]);
  if (Number(p.price) !== live.price) {
    await q(`INSERT INTO product_events (product_id, name, kind, old_value, new_value) VALUES ($1,$2,'price',$3,$4)`, [p.id, p.name, String(p.price), String(live.price)]);
  }
  await event(null, 'price', `💱 قیمت «${p.name}» هنگام ${source} عوض شده بود و از این به بعد اعمال شد: ${toman(p.price)} ← ${toman(live.price)}`,
    { product_id: p.id, old: Number(p.price), new: live.price, old_cost: Number(p.cost_price), new_cost: live.cost_price });
}

// ---------------------------------------------------------------- review
async function review(payload, requestedBy, job) {
  const cityId = int(payload.city_id, 'شهر');
  // The same customer reviewing again (changed basket/address): release the previous hold first.
  if (payload.replaces_review_id) await q('DELETE FROM review_holds WHERE review_id = $1', [int(payload.replaces_review_id, 'مرور قبلی')]);
  const wanted = (payload.items ?? []).map((i) => ({ product_id: int(i.product_id, 'کد محصول'), quantity: int(i.quantity, 'تعداد', 1, MAX_QTY) }));
  if (!wanted.length || wanted.length > MAX_ITEMS) throw new InputError('سبد خالی است یا اقلامش زیاد است');
  const ids = [...new Set(wanted.map((i) => i.product_id))];
  if (ids.length !== wanted.length) throw new InputError('یک محصول دو بار در سبد آمده است');

  const rows = await q(`SELECT id, name, price, cost_price, stock, category, image_url FROM supplier_products
                         WHERE id = ANY($1) AND is_sellable AND missing_since IS NULL`, [ids]);
  const ours = new Map(rows.map((r) => [r.id, r]));
  const sellable = wanted.filter((i) => ours.has(i.product_id));

  const items = [];
  let shipping = null;
  if (sellable.length) {
    shipping = await shippingFor(cityId, sellable);
    const live = await L.validateBasket(sellable, shipping?.warehouse_code ?? null);
    const held = await reserved();
    for (const w of wanted) {
      const p = ours.get(w.product_id);
      const l = live.products.get(w.product_id);
      if (!p || !l) { items.push({ product_id: w.product_id, name: p?.name ?? null, requested: w.quantity, quantity: 0, status: 'unavailable' }); continue; }
      const price_changed = Number(p.price) !== l.price ? { old: Number(p.price), new: l.price } : null;
      if (price_changed || Number(p.cost_price) !== l.cost_price) await applyPriceChange(p, l, 'مرور سفارش');
      const available = Math.max(0, l.inventory - (held.get(p.id) ?? 0));
      const quantity = Math.min(w.quantity, available);
      items.push({
        product_id: p.id, name: p.name, image_url: p.image_url, requested: w.quantity, quantity,
        status: quantity === 0 ? 'unavailable' : quantity < w.quantity ? 'adjusted' : 'ok',
        unit_price: l.price, line_total: l.price * quantity, price_changed,
        limited: quantity > 0 && available - quantity <= config.limitedStock,
        _cost: l.cost_price, _category: p.category,
      });
    }
  } else {
    for (const w of wanted) items.push({ product_id: w.product_id, name: null, requested: w.quantity, quantity: 0, status: 'unavailable' });
  }

  // Similar products in stock for every item that is out (same first category, closest price).
  const alternatives = {};
  for (const it of items.filter((i) => i.status === 'unavailable')) {
    const p = ours.get(it.product_id);
    if (!p?.category?.length) continue;
    alternatives[it.product_id] = await q(
      `SELECT id AS product_id, name, price AS unit_price, image_url FROM supplier_products
        WHERE is_sellable AND missing_since IS NULL AND stock > 0 AND $1 = ANY(category) AND NOT (id = ANY($2))
        ORDER BY abs(price - $3) LIMIT 3`, [p.category[0], ids, p.price]);
  }

  const items_total = items.reduce((s, i) => s + (i.line_total ?? 0), 0);
  const placeable = items.some((i) => i.quantity > 0);
  const expiresAt = new Date(Date.now() + REVIEW_TTL_MS);
  if (placeable && shipping) {
    for (const it of items.filter((i) => i.quantity > 0)) {
      await q('INSERT INTO review_holds (review_id, product_id, quantity, expires_at) VALUES ($1,$2,$3,$4)', [job.id, it.product_id, it.quantity, expiresAt]);
    }
  }
  return {
    ok: placeable && Boolean(shipping),
    reason: !placeable ? 'هیچ‌کدام از اقلام سبد موجود نیست' : !shipping ? 'ارسال پستی به این شهر ممکن نیست' : null,
    city_id: cityId,
    items: items.map(({ _cost, _category, ...rest }) => rest), // our cost never leaves this service
    alternatives,
    shipping: shipping ? { price: shipping.price, title: shipping.title } : null,
    items_total,
    total: items_total + (shipping?.price ?? 0),
    urgent: items.some((i) => i.limited),
    expires_at: expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------- create (customer paid)
async function create(payload, requestedBy) {
  const reviewId = int(payload.review_id, 'شناسه‌ی مرور سفارش');
  const c = payload.customer ?? {}, a = payload.address ?? {};
  const customer = {
    first_name: text(c.first_name, 'نام', 60), last_name: text(c.last_name, 'نام خانوادگی', 60),
    mobile: text(c.mobile, 'موبایل', 11),
  };
  if (!/^09\d{9}$/.test(customer.mobile)) throw new InputError('موبایل باید ۱۱ رقم و با ۰۹ شروع شود');
  const address = {
    province_id: int(a.province_id, 'استان'), city_id: int(a.city_id, 'شهر'),
    postal_code: text(a.postal_code, 'کد پستی', 10), address: text(a.address, 'آدرس', 400),
    plate: text(a.plate, 'پلاک', 20), unit: String(a.unit ?? '').trim().slice(0, 20),
  };
  if (!/^\d{10}$/.test(address.postal_code)) throw new InputError('کد پستی باید ۱۰ رقم باشد');
  const method = payload.payment === 'wallet' ? 'wallet' : 'gateway';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A review is single-use and short-lived; lock it so two clicks cannot create two orders.
    const { rows: [job] } = await client.query(
      `SELECT * FROM order_jobs WHERE id = $1 AND kind = 'review' AND ok FOR UPDATE`, [reviewId]);
    if (!job) throw new InputError('مرور سفارش پیدا نشد؛ دوباره سبد را مرور کنید');
    const r = job.result;
    if (r.order_id) throw new InputError('این مرور سفارش قبلاً ثبت شده است');
    if (Date.now() > new Date(r.expires_at).getTime()) throw new InputError('مرور سفارش منقضی شده؛ دوباره مرور کنید تا قیمت و موجودی تازه شود');
    if (!r.ok) throw new InputError(r.reason || 'این سبد قابل ثبت نیست');
    if (r.city_id !== address.city_id) throw new InputError('شهر آدرس با شهر مرور سفارش یکی نیست');

    if (method === 'wallet') {
      const { rows: [{ balance }] } = await client.query(
        `SELECT COALESCE(sum(amount),0)::bigint AS balance FROM wallet_ledger WHERE customer_mobile = $1`, [customer.mobile]);
      if (Number(balance) < r.total) throw new InputError(`موجودی کیف پول کافی نیست (${toman(balance)})`);
    }
    const { rows: [order] } = await client.query(
      `INSERT INTO shop_orders (urgent, customer_first_name, customer_last_name, customer_mobile, province_id, city_id,
                                postal_code, address, plate, unit, items_total, shipping_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [r.urgent, customer.first_name, customer.last_name, customer.mobile, address.province_id, address.city_id,
        address.postal_code, address.address, address.plate, address.unit || null, r.items_total, r.shipping.price]);
    for (const it of r.items.filter((i) => i.quantity > 0)) {
      await client.query('INSERT INTO shop_order_items (order_id, product_id, name, quantity, unit_price) VALUES ($1,$2,$3,$4,$5)',
        [order.id, it.product_id, it.name, it.quantity, it.unit_price]);
    }
    if (method === 'wallet') {
      await client.query(`INSERT INTO wallet_ledger (customer_mobile, amount, reason, order_id) VALUES ($1,$2,'پرداخت سفارش',$3)`,
        [customer.mobile, -r.total, order.id]);
    }
    await client.query(`UPDATE order_jobs SET result = result || jsonb_build_object('order_id', $2::int) WHERE id = $1`, [reviewId, order.id]);
    await client.query('DELETE FROM review_holds WHERE review_id = $1', [reviewId]); // the queued order holds it now
    await client.query('COMMIT');

    const lines = r.items.filter((i) => i.quantity > 0).map((i) => `• ${i.name} × ${i.quantity}${i.limited ? ' ⚡️' : ''}`);
    await event(order.id, 'new', [`🛒 سفارش جدید #${order.id}${r.urgent ? ' · ⚡️ فوری (موجودی محدود)' : ''}`,
      ...lines, `مبلغ مشتری: ${toman(r.total)} (ارسال ${toman(r.shipping.price)})`].join('\n'), { urgent: r.urgent, requested_by: requestedBy });
    log.info(`orders: #${order.id} queued (${r.items.length} items)`);
    return { order_id: order.id, status: 'queued', total: r.total };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------- refunds
async function refund(order, amount, reason) {
  if (amount <= 0) return;
  await q(`INSERT INTO wallet_ledger (customer_mobile, amount, reason, order_id) VALUES ($1,$2,$3,$4)`, [order.customer_mobile, amount, reason, order.id]);
  await q('UPDATE shop_orders SET refunded_total = refunded_total + $2 WHERE id = $1', [order.id, amount]);
}

// ---------------------------------------------------------------- place (admin pressed the button)
async function place(payload, requestedBy) {
  const orderId = int(payload.order_id, 'شماره‌ی سفارش');
  const [order] = await q(`UPDATE shop_orders SET status = 'placing', last_error = NULL WHERE id = $1 AND status = 'queued' RETURNING *`, [orderId]);
  if (!order) {
    const [cur] = await q('SELECT status, payment_url FROM shop_orders WHERE id = $1', [orderId]);
    if (!cur) throw new InputError(`سفارش #${orderId} پیدا نشد`);
    if (cur.status === 'awaiting_payment') return { order_id: orderId, status: cur.status, payment_url: cur.payment_url, already: true };
    throw new InputError(`سفارش #${orderId} در صف ثبت نیست (وضعیت: ${cur.status})`);
  }
  const dryRun = config.ordersDryRun !== false;
  let addressId = null;
  let createdAtLiateam = false; // after this point the order may exist at Liateam: never requeue automatically
  try {
    const items = await q(`SELECT * FROM shop_order_items WHERE order_id = $1 AND status = 'ok' ORDER BY id`, [orderId]);
    const ship = await shippingFor(order.city_id, items);
    if (!ship) throw new L.LiateamError('لیاتیم دیگر به این شهر ارسال پستی ندارد');
    await pause();
    const live = await L.validateBasket(items, ship.warehouse_code);

    // Place what is in stock; refund the rest to the customer's wallet.
    const toPlace = [], refunds = [];
    for (const it of items) {
      const l = live.products.get(it.product_id);
      const qty = l?.valid !== false ? Math.min(it.quantity, l?.inventory ?? 0) : 0;
      if (qty < it.quantity) refunds.push({ it, missing: it.quantity - qty });
      if (qty > 0) toPlace.push({ ...it, quantity: qty, cost: l.cost_price, live: l });
      if (l && (l.price !== Number(it.unit_price))) {
        const [p] = await q('SELECT id, name, price, cost_price FROM supplier_products WHERE id = $1', [it.product_id]);
        if (p && Number(p.price) !== l.price) await applyPriceChange(p, l, `ثبت سفارش #${orderId}`);
      }
    }
    if (!toPlace.length) {
      await refund(order, Number(order.items_total) + Number(order.shipping_price), 'برگشت وجه: اقلام سفارش در لیاتیم تمام شد');
      await q(`UPDATE shop_order_items SET status = 'refunded' WHERE order_id = $1`, [orderId]);
      await q(`UPDATE shop_orders SET status = 'refunded' WHERE id = $1`, [orderId]);
      await event(orderId, 'refund', `↩️ سفارش #${orderId} ثبت نشد: هیچ قلمی در لیاتیم موجود نبود. کل مبلغ (${toman(Number(order.items_total) + Number(order.shipping_price))}) به کیف پول مشتری برگشت.`);
      return { order_id: orderId, status: 'refunded' };
    }

    // Recompute what we pay; Liateam's own total must match goods + shipping or we stop.
    await pause();
    const final = toPlace.length === items.length ? live : await L.validateBasket(toPlace, ship.warehouse_code);
    const goods = toPlace.reduce((s, i) => s + i.cost * i.quantity, 0);
    if (Math.abs(final.payable - goods) > 10) {
      throw new L.LiateamError(`جمع لیاتیم (${final.payable}) با جمع اقلام (${goods}) نمی‌خواند؛ ثبت متوقف شد`);
    }
    const shipNow = await shippingFor(order.city_id, toPlace);
    const total = final.payable + (shipNow?.price ?? ship.price);
    const paidByCustomer = Number(order.items_total) + Number(order.shipping_price)
      - refunds.reduce((s, r) => s + r.missing * Number(r.it.unit_price), 0);

    const methods = await L.paymentMethods();
    const payment = methods.find((m) => m.id === config.ordersPaymentId) ?? methods[0];
    if (!payment) throw new L.LiateamError('هیچ درگاه پرداختی در لیاتیم نیست');

    await pause();
    const addr = await L.addAddress({
      title: `سفارش ${orderId}`, mobile: order.customer_mobile, first_name: order.customer_first_name, last_name: order.customer_last_name,
      province_id: order.province_id, city_id: order.city_id, postal_code: order.postal_code, plate: order.plate, unit: order.unit, address: order.address,
    });
    addressId = addr.id;
    if (!addr.canPost) throw new L.LiateamError('لیاتیم ارسال پستی به این آدرس را قبول نمی‌کند');

    const body = {
      product_groups: toPlace.map((i) => ({ code: i.product_id, count: i.quantity })),
      exam_id: null, warehouse_code: ship.warehouse_code, address_id: addressId, send_type_id: (shipNow ?? ship).send_type_id,
      delivery_date: null, shift: null,
      receivers: [{ first_name: order.customer_first_name, last_name: order.customer_last_name, mobile: order.customer_mobile }],
      total_payable_price: total, payment_id: payment.id, description: null,
    };

    if (dryRun) {
      await L.deleteAddress(addressId).catch(() => {});
      addressId = null;
      const masked = { ...body, receivers: [{ first_name: '…', last_name: '…', mobile: '…' }] };
      await q(`UPDATE shop_orders SET status = 'queued', dry_run_result = $2 WHERE id = $1`, [orderId, { at: new Date().toISOString(), body: masked, total, refunds: refunds.map((r) => ({ product_id: r.it.product_id, missing: r.missing })) }]);
      await event(orderId, 'placed', [`🧪 حالت آزمایشی · سفارش #${orderId} تا قبل از ثبت نهایی جلو رفت:`,
        `• موجودی و قیمت: بررسی شد${refunds.length ? ` (${refunds.length} قلم ناموجود بود)` : ''}`,
        `• آدرس: ساخته و دوباره حذف شد`, `• مبلغ قابل پرداخت به لیاتیم: ${toman(total)} · درگاه ${payment.name}`,
        'سفارشی در لیاتیم ثبت نشد. برای ثبت واقعی، حالت آزمایشی را در تنظیمات خاموش کنید.'].join('\n'), { dry_run: true });
      return { order_id: orderId, status: 'queued', dry_run: true, total };
    }

    await pause();
    createdAtLiateam = true; // set before the call: a timeout may still have created the order
    const created = await L.createOrder(body);
    let code = created?.code ?? created?.order_code ?? created?.order?.code ?? null;
    if (!code) {
      // Response shape not captured yet: find the order we just made (same total, last 3 minutes).
      const list = await L.listOrders(5);
      code = list?.list?.find((o) => Number(o.total_gateway_price) === total && Date.now() - new Date(o.created_at).getTime() < 180_000)?.code ?? null;
    }
    if (!code) {
      await q(`UPDATE shop_orders SET status = 'awaiting_payment', liateam_address_id = $2, liateam_total = $3, placed_at = now(), placed_by = $4,
                  last_error = 'شماره‌ی سفارش لیاتیم پیدا نشد' WHERE id = $1`, [orderId, addressId, total, requestedBy]);
      await event(orderId, 'error', `⚠️ سفارش #${orderId} احتمالاً در لیاتیم ثبت شد ولی شماره‌اش پیدا نشد. لطفاً در پنل لیاتیم «سفارش‌های من» را نگاه کنید و پرداخت کنید.`);
      return { order_id: orderId, status: 'awaiting_payment', payment_url: null };
    }

    const url = L.paymentUrl(payment.id, code);
    for (const r of refunds) {
      await refund(order, r.missing * Number(r.it.unit_price), `برگشت وجه: «${r.it.name}» در لیاتیم تمام شد`);
      if (r.missing === r.it.quantity) await q(`UPDATE shop_order_items SET status = 'refunded' WHERE id = $1`, [r.it.id]);
      else await q('UPDATE shop_order_items SET quantity = $2 WHERE id = $1', [r.it.id, r.it.quantity - r.missing]);
    }
    for (const i of toPlace) await q('UPDATE shop_order_items SET unit_cost = $2 WHERE id = $1', [i.id, i.cost]);
    await q(`UPDATE shop_orders SET status = 'awaiting_payment', liateam_order_code = $2, liateam_address_id = $3, liateam_total = $4,
                payment_url = $5, placed_at = now(), placed_by = $6 WHERE id = $1`, [orderId, String(code), addressId, total, url, requestedBy]);

    const margin = paidByCustomer - total;
    await event(orderId, 'placed', [`✅ سفارش #${orderId} در لیاتیم ثبت شد (کد ${code})`,
      `مبلغ پرداخت به لیاتیم: ${toman(total)}`, margin < 0 ? `⚠️ ضرر این سفارش: ${toman(-margin)} (قیمت لیاتیم بالا رفته)` : `سود: ${toman(margin)}`,
      ...(refunds.length ? [`↩️ ${refunds.length} قلم ناموجود بود و مبلغش به کیف پول مشتری برگشت`] : []),
      '⏳ لیاتیم سفارش پرداخت‌نشده را حدود ۲۰ دقیقه بعد لغو می‌کند.'].join('\n'), { payment_url: url, code: String(code), total });
    log.info(`orders: #${orderId} placed at Liateam (${code})`);
    return { order_id: orderId, status: 'awaiting_payment', payment_url: url, code: String(code), total };
  } catch (e) {
    if (createdAtLiateam) {
      // The order may already exist at Liateam: placing again could duplicate it. A person decides.
      await q(`UPDATE shop_orders SET status = 'awaiting_payment', liateam_address_id = COALESCE(liateam_address_id, $3),
                  placed_at = COALESCE(placed_at, now()), placed_by = COALESCE(placed_by, $4), last_error = $2 WHERE id = $1`,
        [orderId, e.message, addressId, requestedBy]);
      await event(orderId, 'error', `🚨 هنگام ثبت سفارش #${orderId} در لیاتیم خطا رخ داد و ممکن است سفارش ثبت شده باشد:\n${e.message}\n` +
        'برای جلوگیری از ثبت تکراری، سفارش دوباره خودکار ثبت نمی‌شود. لطفاً «سفارش‌های من» در پنل لیاتیم را نگاه کنید.');
      throw e;
    }
    if (addressId) await L.deleteAddress(addressId).catch(() => {});
    await q(`UPDATE shop_orders SET status = 'queued', last_error = $2 WHERE id = $1 AND status = 'placing'`, [orderId, e.message]);
    await event(orderId, 'error', `🚨 ثبت سفارش #${orderId} انجام نشد و سفارش به صف برگشت:\n${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------- helpers for the site / test panel
// Province and city ids must be Liateam's (shipping and addresses use them). Cached for a day.
const geoCache = new Map();
async function geo(payload) {
  const key = payload.province_id ? `c${int(payload.province_id, 'استان')}` : 'p';
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.list;
  const raw = payload.province_id ? await L.cities(payload.province_id) : await L.provinces();
  const list = (Array.isArray(raw) ? raw : raw?.list ?? []).map((x) => ({ id: Number(x.id), name: x.name ?? x.title })).filter((x) => x.id && x.name);
  if (!list.length) throw new L.LiateamError('فهرست استان/شهر از لیاتیم خالی برگشت');
  geoCache.set(key, { at: Date.now(), list });
  return list;
}

/** Test-only top-up of the simulated wallet (the real site will credit wallets itself). */
async function topup(payload, requestedBy) {
  const mobile = text(payload.mobile, 'موبایل', 11);
  if (!/^09\d{9}$/.test(mobile)) throw new InputError('موبایل نامعتبر است');
  const amount = int(payload.amount, 'مبلغ', 10_000, 10_000_000_000);
  await q(`INSERT INTO wallet_ledger (customer_mobile, amount, reason) VALUES ($1,$2,$3)`, [mobile, amount, `شارژ آزمایشی (${requestedBy})`]);
  const [{ balance }] = await q('SELECT COALESCE(sum(amount),0)::bigint AS balance FROM wallet_ledger WHERE customer_mobile = $1', [mobile]);
  return { balance: Number(balance) };
}

// ---------------------------------------------------------------- jobs
const HANDLERS = { review, create, place, geo, topup };

async function runPendingJobs() {
  for (;;) {
    const client = await pool.connect();
    let job;
    try {
      await client.query('BEGIN');
      ({ rows: [job] } = await client.query(
        `UPDATE order_jobs SET picked_at = now() WHERE id = (SELECT id FROM order_jobs WHERE picked_at IS NULL ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`));
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    if (!job) return;
    let ok = false, result;
    try {
      const handler = HANDLERS[job.kind];
      if (!handler) throw new InputError(`نوع کار ناشناخته: ${job.kind}`);
      result = await handler(job.payload, job.requested_by, job);
      ok = true;
    } catch (e) {
      result = { error: e instanceof InputError ? e.message : e instanceof AuthError ? `سشن لیاتیم: ${e.message}` : e.message, kind: e.constructor.name };
      if (!(e instanceof InputError)) log.warn(`orders: job ${job.id} (${job.kind}) failed`, { error: e.message });
      if (e instanceof AuthError) await setStatus(pool, 'session', { ok: false, at: new Date().toISOString(), error: e.message }).catch(() => {});
    }
    // Stringify: node-pg turns a top-level JS array into a Postgres array, not JSON.
    await q('UPDATE order_jobs SET done_at = now(), ok = $2, result = $3::jsonb WHERE id = $1', [job.id, ok, JSON.stringify(result ?? null)]);
  }
}

// ---------------------------------------------------------------- tracking
async function track() {
  const due = await q(`SELECT * FROM shop_orders WHERE liateam_order_code IS NOT NULL AND
      (status = 'awaiting_payment' OR (status = 'supplier_paid' AND (tracking IS NULL OR (tracking->>'checked_at')::timestamptz < now() - interval '30 minutes')))`);
  for (const o of due) {
    try {
      const d = await L.getOrder(o.liateam_order_code);
      const boxes = Array.isArray(d?.boxes) ? d.boxes : [];
      if (o.status === 'awaiting_payment' && d.is_payed) {
        await q(`UPDATE shop_orders SET status = 'supplier_paid', supplier_paid_at = now() WHERE id = $1`, [o.id]);
        await event(o.id, 'paid', `💳 پرداخت سفارش #${o.id} در لیاتیم تأیید شد.`);
      } else if (o.status === 'awaiting_payment' && d.is_canceled) {
        // Unpaid orders are canceled by Liateam after ~20 min: back to the queue, place again later.
        if (o.liateam_address_id) await L.deleteAddress(o.liateam_address_id).catch(() => {});
        await q(`UPDATE shop_orders SET status = 'queued', liateam_order_code = NULL, liateam_address_id = NULL, payment_url = NULL, placed_at = NULL WHERE id = $1`, [o.id]);
        await event(o.id, 'canceled', `⌛️ لیاتیم سفارش #${o.id} را چون پرداخت نشد لغو کرد. سفارش به صف برگشت؛ هر وقت آماده‌ی پرداخت بودید دوباره «ثبت و پرداخت» را بزنید.`);
      } else if (o.status === 'supplier_paid' && (d.status === 'sent' || boxes.length)) {
        await q(`UPDATE shop_orders SET status = 'sent', sent_at = now(), tracking = $2 WHERE id = $1`, [o.id, { checked_at: new Date().toISOString(), status: d.status, boxes }]);
        if (o.liateam_address_id) await L.deleteAddress(o.liateam_address_id).catch((e) => log.warn('orders: address cleanup failed', { error: e.message }));
        await event(o.id, 'sent', `📦 سفارش #${o.id} از انبار لیاتیم ارسال شد.`, { boxes });
      } else if (o.status === 'supplier_paid' && d.is_canceled) {
        await q(`UPDATE shop_orders SET status = 'canceled', last_error = 'لیاتیم سفارش پرداخت‌شده را لغو کرد' WHERE id = $1`, [o.id]);
        await event(o.id, 'error', `🚨 لیاتیم سفارش پرداخت‌شده‌ی #${o.id} (کد ${o.liateam_order_code}) را لغو کرد. بازگشت وجه از لیاتیم و مشتری را دستی پیگیری کنید.`);
      } else if (o.status === 'supplier_paid') {
        await q(`UPDATE shop_orders SET tracking = $2 WHERE id = $1`, [o.id, { checked_at: new Date().toISOString(), status: d.status, boxes }]);
      }
    } catch (e) {
      log.warn(`orders: tracking #${o.id} failed`, { error: e.message });
    }
    await sleep(1500 + Math.random() * 2000);
  }

  // Remind admins about orders waiting in the queue (not at night).
  if (!inQuietHours(config.quietHours)) {
    const waiting = await q(`SELECT id, urgent, created_at FROM shop_orders WHERE status = 'queued'
        AND created_at < now() - $1::interval AND (reminded_at IS NULL OR reminded_at < now() - $1::interval)`, [`${REMIND_AFTER_MS / 1000} seconds`]);
    for (const o of waiting) {
      await q('UPDATE shop_orders SET reminded_at = now() WHERE id = $1', [o.id]);
      await event(o.id, 'reminder', `⏰ سفارش #${o.id}${o.urgent ? ' (⚡️ فوری)' : ''} هنوز در صف ثبت است. مشتری پرداخت کرده؛ لطفاً «ثبت و پرداخت» را بزنید.`);
    }
  }
}

// ---------------------------------------------------------------- main
await applySettings(pool, config);
log.info(`orders: service started (dry run: ${config.ordersDryRun !== false})`);

const listener = new pg.Client({ connectionString: config.databaseUrl });
await listener.connect();
let wake = null;
listener.on('notification', () => wake?.());
listener.on('error', (e) => { log.warn('orders: listener lost, exiting for restart', { error: e.message }); process.exit(1); });
await listener.query('LISTEN order_jobs');

let lastTrack = 0;
for (;;) {
  try {
    await applySettings(pool, config);
    await runPendingJobs();
    await q('DELETE FROM review_holds WHERE expires_at < now()');
    if (Date.now() - lastTrack > 120_000) {
      lastTrack = Date.now();
      await track();
    }
    await setStatus(pool, 'orders', { heartbeat: new Date().toISOString(), dry_run: config.ordersDryRun !== false });
  } catch (e) {
    log.warn('orders: loop error', { error: e.message });
  }
  await new Promise((r) => { wake = r; setTimeout(r, 5_000); });
  wake = null;
}
