// Source record -> normalized product. All money values are integers in TOMAN (Liateam's own unit).
//
// Each field is read from a list of candidate paths (primary first). If the primary path is
// missing but a fallback works, the product is still used and the fallback is reported so we
// notice the drift. If no path exists at all, a StructureError is thrown and the run stops.
import { StructureError } from './rsc.mjs';
import { config } from './config.mjs';

export const FIELD_PATHS = {
  name: ['title', 'name', 'alt_home_page_image'],
  price: ['pricing.price', 'price', 'pricing.base_price', 'pricing.consumer_price'],
  cost_price: ['pricing.payable_price', 'payable_price', 'pricing.final_price', 'pricing.user_price'],
  stock: ['inventory.total_inventory', 'total_inventory', 'inventory.limit_buy_inventory', 'inventory.count', 'stock'],
};
// Optional: product picture. First http(s) URL found wins; absence is never an error.
export const IMAGE_PATHS = ['home_page_image', 'image', 'thumbnail', 'main_image', 'cover', 'images.0.url', 'images.0', 'media.0.url'];
export function imageOf(raw) {
  for (const path of IMAGE_PATHS) {
    const v = get(raw, path);
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return null;
}
const FIELD_LABEL = { name: 'نام', price: 'قیمت', cost_price: 'قیمت تمام‌شده (payable_price)', stock: 'موجودی' };

// Liateam's own discounts in pricing.discounts that only concern us as a partner (our purchase price): never the
// customer's discount.
const PARTNER_DISCOUNTS = new Set(['base_retail', 'extra_retail_percent']);
/**
 * The discount liateam.ir itself shows the customer (e.g. type «discount_product», «زمانی کوتاه برای انتخابی خاص»
 * 15%): the sum of the shown (can_show) discounts in pricing.discounts that are not partner discounts, in percent,
 * 0–90. 0 when Liateam shows none. pricing.price stays the price before this discount.
 */
export function consumerDiscountOf(raw) {
  const list = raw?.pricing?.discounts;
  if (!Array.isArray(list)) return 0;
  let sum = 0;
  for (const d of list) {
    if (!d || PARTNER_DISCOUNTS.has(d.type) || d.can_show !== true || d.used_in_calc === false) continue;
    const pct = Number(d.percent);
    if (Number.isFinite(pct) && pct > 0) sum += pct;
  }
  return Math.min(90, Math.round(sum * 100) / 100);
}

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Returns { value, path } for the first candidate path whose key exists, or null. */
function resolve(raw, field) {
  for (const path of FIELD_PATHS[field]) {
    const v = get(raw, path);
    if (v !== undefined) return { value: v, path };
  }
  return null;
}

export function isSellable(code, categories) {
  if (config.sellableOverrides.includes(code)) return true;
  return !categories.some((c) => config.excludedCategories.includes(c));
}

/**
 * @param raw   product object from the RSC payload
 * @param ctx   { page } used in error messages
 * @returns { product, fallbacks: [{field, path}] }
 */
export function normalize(raw, ctx = {}) {
  const where = `${ctx.page ? `صفحه‌ی ${ctx.page}، ` : ''}محصول ${raw?.code ?? '?'}`;
  if (typeof raw?.code !== 'number') throw new StructureError(`شناسه‌ی محصول (code) پیدا نشد در ${where}`);

  const fields = {};
  const fallbacks = [];
  for (const field of Object.keys(FIELD_PATHS)) {
    const hit = resolve(raw, field);
    if (!hit) {
      throw new StructureError(
        `فیلد ${FIELD_LABEL[field]} پیدا نشد در ${where} (مسیرهای امتحان‌شده: ${FIELD_PATHS[field].join(', ')})`,
      );
    }
    if (hit.path !== FIELD_PATHS[field][0]) fallbacks.push({ field, path: hit.path });
    fields[field] = hit.value;
  }

  const name = String(fields.name ?? '').trim();
  if (!name) throw new StructureError(`نام خالی است در ${where}`);
  const category = Array.isArray(raw.category_codes) ? raw.category_codes : [];

  return {
    product: {
      id: raw.code, // supplier product/group code; used in /products/{code}
      uuid: raw.id ?? null,
      name,
      price: toToman(fields.price), // selling price = Liateam's consumer price, TOMAN
      cost_price: toToman(fields.cost_price), // payable_price: our purchase cost, TOMAN, internal only
      consumer_discount_percent: consumerDiscountOf(raw), // the discount liateam.ir shows the customer, 0 = none
      stock: toInt(fields.stock),
      category,
      is_available: raw.inventory?.is_available ?? null,
      image_url: imageOf(raw),
      is_sellable: isSellable(raw.code, category),
    },
    fallbacks,
  };
}

/**
 * MONEY UNIT: Liateam's pricing.price / payable_price are TOMAN. Proven on 2026-10-17 against the prices their
 * own product pages display (explore/compare-prices.mjs: 11 of 12 products show exactly the raw number with
 * «تومان», none show raw/10; the 12th was out of stock, where no price is shown). Their order API
 * (total_payable_price, total_gateway_price) uses the same unit. So the whole system stores and computes in
 * TOMAN, unchanged from the source; anything that needs rial (e.g. a payment gateway) converts at its edge.
 */
export const SOURCE_PRICE_UNIT = 'toman';

// Values that exist but are empty/zero pass through as null/0; the sanity check rejects them per product.
const toToman = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const toInt = (v) => (v == null || v === '' || !Number.isInteger(Number(v)) ? null : Number(v));
