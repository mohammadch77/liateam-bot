// Source record -> normalized product. All money values are integers in RIAL.
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
const FIELD_LABEL = { name: 'نام', price: 'قیمت', cost_price: 'قیمت تمام‌شده (payable_price)', stock: 'موجودی' };

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
      price: toRial(fields.price), // selling price
      cost_price: toRial(fields.cost_price), // our purchase cost - internal only
      stock: toInt(fields.stock),
      category,
      is_available: raw.inventory?.is_available ?? null,
      is_sellable: isSellable(raw.code, category),
    },
    fallbacks,
  };
}

// Values that exist but are empty/zero pass through as null/0; the sanity check rejects them per product.
const toRial = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const toInt = (v) => (v == null || v === '' || !Number.isInteger(Number(v)) ? null : Number(v));
