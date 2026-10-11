// Liateam client API used for orders (basket check, addresses, shipping, order, tracking).
// Discovered in explore/capture-order.mjs. Auth: header `Authorization: <lia-token>` (no "Bearer"),
// the same token the sync keeps in .auth/state.json - read fresh on every call, because the worker
// may log in again and replace it. This module never logs in itself: a rejected token is an
// AuthError and the sync worker's next run renews the session.
import fs from 'node:fs';
import { fetch, Agent } from 'undici';
import { config } from './config.mjs';
import { AuthError } from './auth.mjs';

const BASE = `${config.baseUrl}/api/v1/client`;
// IPv4 only, like the messenger client: a half-working IPv6 route just hangs.
const dispatcher = new Agent({ connect: { family: 4, timeout: 10_000 } });

export class LiateamError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function token() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(config.storageStatePath, 'utf8'));
  } catch {
    throw new AuthError('سشن لیاتیم پیدا نشد (.auth/state.json)');
  }
  const t = state.cookies?.find((c) => c.name === 'lia-token')?.value;
  if (!t) throw new AuthError('توکن lia-token در سشن ذخیره‌شده نیست');
  return t;
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: token(),
        Accept: 'application/json',
        'Accept-Language': 'fa-IR,fa;q=0.9',
        Origin: config.baseUrl,
        Referer: `${config.baseUrl}/checkout`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      dispatcher,
    });
  } catch (e) {
    throw new LiateamError(`${method} ${path}: شبکه (${e.cause?.code || e.name})`);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new AuthError(`${method} ${path}: سشن لیاتیم رد شد (HTTP ${res.status})`);
  if (!res.ok || !json || json.success === false) {
    throw new LiateamError(`${method} ${path}: HTTP ${res.status} ${json?.message ?? ''}`.trim(), { status: res.status, body: json });
  }
  return json.data;
}

const groups = (items) => items.map((i) => ({ code: i.product_id, count: i.quantity }));

/**
 * Live price + stock for a basket. Returns per product code:
 *   { valid, requested, inventory, price, cost_price }  plus totals.
 */
export async function validateBasket(items, warehouseCode = null) {
  const d = await call('POST', '/product/validate-basket', { warehouse_code: warehouseCode, product_groups: groups(items) });
  if (!d || typeof d.products !== 'object') throw new LiateamError('validate-basket: ساختار پاسخ عوض شده (products نیست)');
  const products = new Map();
  for (const [code, p] of Object.entries(d.products)) {
    const price = Number(p?.pricing?.price);
    const cost = Number(p?.pricing?.payable_price);
    if (!Number.isFinite(price) || !Number.isFinite(cost)) throw new LiateamError(`validate-basket: قیمت محصول ${code} در پاسخ نیست`);
    products.set(Number(code), {
      valid: p.is_valid_basket_product === true,
      requested: Number(p.requested_count),
      inventory: Number(p.total_inventory ?? 0),
      price,
      cost_price: cost,
    });
  }
  return { valid: d.is_valid_basket === true, payable: Number(d.total_payable_price), products };
}

/** Post shipping options for a city: [{ send_type_id, price, warehouse_code, type, title }] */
export async function logisticDeliveries(cityId, items) {
  const d = await call('POST', `/shipment/logistic-deliveries?city_id=${encodeURIComponent(cityId)}`, { city_id: String(cityId), product_groups: groups(items) });
  if (!Array.isArray(d)) throw new LiateamError('logistic-deliveries: ساختار پاسخ عوض شده');
  return d.map((o) => ({
    send_type_id: o.shop_send_type_id,
    price: Number(o.transport_price ?? o.price),
    warehouse_code: o.warehouse_code,
    type: o.delivery_type,
    title: o.delivery_type_title,
  }));
}

export const provinces = () => call('GET', '/user/provinces');
export const cities = (provinceId) => call('GET', `/user/provinces/${encodeURIComponent(provinceId)}/cities`);
export const paymentMethods = () => call('GET', '/payment/payments');

/** @returns new address id (string) */
export async function addAddress(a) {
  const d = await call('POST', '/user/user-addresses', {
    title: a.title, phone: a.mobile, first_name: a.first_name, last_name: a.last_name,
    province_id: String(a.province_id), city_id: String(a.city_id), postal_code: a.postal_code,
    number: a.plate, unit: a.unit ?? '', address: a.address,
  });
  if (!d?.id) throw new LiateamError('user-addresses: شناسه‌ی آدرس جدید در پاسخ نیست');
  return { id: String(d.id), canPost: d.can_post_express !== false };
}

export const deleteAddress = (id) => call('DELETE', `/user/user-addresses/${encodeURIComponent(id)}`);

/** Places the order. Returns {link: "/agamemnon/api/v1/payments/{payment_id}/orders/{code}/send-payment"}. */
export const createOrder = (body) => call('POST', '/order/orders', body);

export const listOrders = (pageSize = 10) => call('GET', `/order/orders?current=1&pageSize=${pageSize}`);
export const getOrder = (code) => call('GET', `/order/orders/${encodeURIComponent(code)}`);

/** Fallback payment link (normally createOrder returns it). Needs no Liateam login: 307 to the bank. */
export const paymentUrl = (paymentId, orderCode) =>
  `${config.baseUrl}/agamemnon/api/v1/payments/${encodeURIComponent(paymentId)}/orders/${encodeURIComponent(orderCode)}/send-payment`;
