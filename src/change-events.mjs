// change_events: one row per real change the bot writes (same transaction as the change itself), announced in
// batches by the messenger and listed by `npm run events:list`. Only values a customer could see are kept: the
// selling price in TOMAN and stock — never the purchase price (cost_price). Pure helpers + the insert.

export const EVENT_TYPES = {
  price_changed: { icon: '💰', label: 'تغییر قیمت', group: 'price' },
  stock_changed: { icon: '📦', label: 'تغییر موجودی', group: 'stock' },
  product_added: { icon: '🆕', label: 'محصول جدید', group: 'catalog' },
  product_removed: { icon: '🗑', label: 'حذف از لیاتیم', group: 'catalog' },
  product_returned: { icon: '↩️', label: 'برگشت به لیاتیم', group: 'catalog' },
  name_changed: { icon: '✏️', label: 'تغییر نام', group: 'catalog' },
  description_changed: { icon: '📝', label: 'تغییر توضیحات', group: 'content' },
  features_changed: { icon: '📝', label: 'تغییر ویژگی‌ها', group: 'content' },
  specs_changed: { icon: '📋', label: 'تغییر مشخصات', group: 'content' },
  how_to_use_changed: { icon: '🧴', label: 'تغییر نحوه‌ی مصرف', group: 'content' },
  video_changed: { icon: '🎬', label: 'تغییر ویدیو', group: 'content' },
  faq_changed: { icon: '❓', label: 'تغییر پرسش‌ها', group: 'content' },
  reviews_changed: { icon: '💬', label: 'نظرات جدید', group: 'content' },
  gallery_changed: { icon: '🖼', label: 'تغییر گالری', group: 'content' },
  images_changed: { icon: '🖼', label: 'تغییر عکس اصلی', group: 'content' },
  facts_changed: { icon: '📏', label: 'تغییر حجم/ماندگاری', group: 'content' },
  concerns_changed: { icon: '🏷', label: 'تغییر «مناسب برای»', group: 'content' },
  banner_changed: { icon: '🎞', label: 'تغییر بنرهای صفحه‌ی اصلی', group: 'content' },
  sync_backoff: { icon: '🛑', label: 'عقب‌نشینی ربات', group: 'errors' },
};

// rich section (product-details.mjs sectionHashes) → event; meta (rating) and tags change too often to be news
const SECTION_EVENT = {
  summary: 'features_changed',
  attributes: 'specs_changed',
  how_to_use: 'how_to_use_changed',
  video: 'video_changed',
  faqs: 'faq_changed',
  reviews: 'reviews_changed',
  gallery: 'gallery_changed',
  facts: 'facts_changed',
  concerns: 'concerns_changed',
};

const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
const toman = (n) => `${fa(Math.round(Number(n)))} تومان`;

/**
 * diffCatalog events → change rows. The purchase-price kind ('cost') is dropped here, at the source, so it can never
 * reach an event, a message or the shop.
 */
export function fromCatalogEvents(events) {
  const out = [];
  for (const e of events) {
    const base = { entity_type: 'product', entity_id: String(e.product_id), product_code: e.product_id };
    switch (e.kind) {
      case 'price': {
        const o = Number(e.old_value), n = Number(e.new_value);
        out.push({ ...base, event_type: 'price_changed', summary_fa: `${e.name}: قیمت از ${toman(o)} به ${toman(n)}`,
          details: { name: e.name, old_price_toman: o, new_price_toman: n } });
        break;
      }
      case 'out_of_stock':
      case 'back_in_stock':
        out.push({ ...base, event_type: 'stock_changed',
          summary_fa: e.kind === 'out_of_stock' ? `${e.name}: ناموجود شد` : `${e.name}: دوباره موجود شد (${fa(Number(e.new_value))} عدد)`,
          details: { name: e.name, old_stock: Number(e.old_value), new_stock: Number(e.new_value) } });
        break;
      case 'new':
        out.push({ ...base, event_type: 'product_added', summary_fa: `${e.name} (${toman(e.new_value)})`,
          details: { name: e.name, price_toman: Number(e.new_value) } });
        break;
      case 'removed':
        out.push({ ...base, event_type: 'product_removed', summary_fa: e.name, details: { name: e.name } });
        break;
      case 'returned':
        out.push({ ...base, event_type: 'product_returned', summary_fa: e.name, details: { name: e.name } });
        break;
      case 'name':
        out.push({ ...base, event_type: 'name_changed', summary_fa: `${e.old_value} ← ${e.name}`,
          details: { old_name: e.old_value, new_name: e.name } });
        break;
      default: // 'cost' and anything unknown: never an event
        break;
    }
  }
  return out;
}

/** Changed rich sections of one product → change rows (a section filled for the first time is not a «change»). */
export function fromSections(productId, name, sections) {
  return sections
    .filter((s) => SECTION_EVENT[s])
    .map((s) => ({ entity_type: 'product', entity_id: String(productId), product_code: productId, event_type: SECTION_EVENT[s],
      summary_fa: name ?? `محصول ${fa(productId)}`, details: { name } }));
}

export const productEvent = (productId, name, type, details = {}) => ({
  entity_type: 'product', entity_id: String(productId), product_code: productId, event_type: type,
  summary_fa: name ?? `محصول ${fa(productId)}`, details: { name, ...details },
});

/** Writes change rows with the caller's client (inside its transaction). */
export async function insertEvents(db, rows) {
  for (const r of rows) {
    await db.query(
      `INSERT INTO change_events (entity_type, entity_id, product_code, event_type, summary_fa, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [r.entity_type, r.entity_id ?? null, r.product_code ?? null, r.event_type, r.summary_fa, JSON.stringify(r.details ?? {})]);
  }
}

/**
 * One message for many events: counts per type, then a few lines per type (newest first is not needed: the order
 * they happened). `maxPerType` lines each, the whole text clipped to `maxChars`.
 */
export function summarize(events, { maxPerType = 5, maxChars = 3800, at = new Date() } = {}) {
  const by = new Map();
  for (const e of events) {
    if (!EVENT_TYPES[e.event_type]) continue;
    if (!by.has(e.event_type)) by.set(e.event_type, []);
    by.get(e.event_type).push(e);
  }
  const order = Object.keys(EVENT_TYPES).filter((t) => by.has(t));
  const time = new Date(at).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });
  const head = [`🛰 تغییرات لیاتیم · ${time}`, order.map((t) => `${fa(by.get(t).length)} ${EVENT_TYPES[t].label}`).join(' · ')];
  const body = [];
  for (const t of order) {
    const list = by.get(t);
    body.push('', `${EVENT_TYPES[t].icon} ${EVENT_TYPES[t].label} (${fa(list.length)})`);
    for (const e of list.slice(0, maxPerType)) body.push(`• ${e.summary_fa}`);
    if (list.length > maxPerType) body.push(`   … و ${fa(list.length - maxPerType)} مورد دیگر`);
  }
  const text = [...head, ...body].join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars - 2)}\n…` : text;
}

/** The notification group a person switches on/off (messenger GROUPS) for an event type. */
export const groupOf = (type) => EVENT_TYPES[type]?.group ?? null;
