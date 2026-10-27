// Pure decisions of the orders service (src/orders.mjs), kept apart so they can be tested without a database.
//
// An order the shop sends carries `expected_total`: what the customer was shown at checkout in Liateam's own
// prices (goods + Liateam's shipping, TOMAN). Right before placing it we re-read the basket; if the live total moved
// by more than the tolerance, or an item cannot be fully supplied, the order stops in `needs_review` instead of being
// placed. Orders without `expected_total` (the dashboard / messenger "place" button) keep the old behaviour: an
// admin who presses the button has seen the current numbers.

export const DEFAULT_TOLERANCE = 10; // TOMAN

/** 'shop' for jobs from the shop site (requested_by = 'shop'), 'bot' for everything else. */
export const originOf = (requestedBy) => (requestedBy === 'shop' ? 'shop' : 'bot');

/**
 * Shop-origin orders are paid and refunded in the shop's own wallet ledger, so the bot never credits its
 * `wallet_ledger` for them (and never debits it either).
 */
export const botWalletApplies = (origin) => origin !== 'shop';

/** payload.max_diff (from the shop's settings) if it is a sane number, else the bot's own tolerance. */
export function toleranceFrom(payloadValue, fallback = DEFAULT_TOLERANCE) {
  const n = Number(payloadValue);
  return payloadValue != null && Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * @param {object}  p
 * @param {number|null} p.expectedTotal  Liateam-priced goods + shipping the customer was shown; null = no check
 * @param {number}  p.tolerance          allowed difference in TOMAN
 * @param {Array<{product_id:number, quantity:number}>} p.items  what the order holds (status ok)
 * @param {Map<number,{valid:boolean, inventory:number, price:number}>} p.liveProducts  fresh validate-basket result
 * @param {number}  p.shippingPrice      Liateam's shipping price now
 * @returns {{ok:true, liveTotal:number|null} | {ok:false, reason:'unavailable'|'price', liveTotal:number, diff:number|null, missing:number[]}}
 */
export function assessPlacement({ expectedTotal, tolerance, items, liveProducts, shippingPrice }) {
  if (expectedTotal == null) return { ok: true, liveTotal: null };
  const missing = [];
  let goods = 0;
  for (const it of items) {
    const l = liveProducts.get(it.product_id);
    const available = l?.valid !== false ? Math.min(it.quantity, l?.inventory ?? 0) : 0;
    if (!l || available < it.quantity) missing.push(it.product_id);
    if (l) goods += l.price * it.quantity;
  }
  const liveTotal = goods + Number(shippingPrice ?? 0);
  if (missing.length) return { ok: false, reason: 'unavailable', liveTotal, diff: null, missing };
  const diff = liveTotal - Number(expectedTotal);
  if (Math.abs(diff) > tolerance) return { ok: false, reason: 'price', liveTotal, diff, missing: [] };
  return { ok: true, liveTotal };
}
