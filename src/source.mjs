// Reads all products from the paginated /categories RSC payload using the saved session.
import { request } from 'playwright';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { parseCategoriesPage, extractAll } from './rsc.mjs';
import { normalize } from './normalize.mjs';
import { parseCategories } from './categories.mjs';
import { AuthError } from './auth.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => config.delayMinMs + Math.random() * (config.delayMaxMs - config.delayMinMs);

/** Top-level field names plus those inside pricing / inventory (values are never kept). */
export function shapeKeys(raw) {
  const keys = Object.keys(raw);
  for (const nest of ['pricing', 'inventory']) {
    if (raw[nest] && typeof raw[nest] === 'object') for (const k of Object.keys(raw[nest])) keys.push(`${nest}.${k}`);
  }
  return keys;
}

/** @returns { products: normalized[], total, fallbacks: string[], categories: Map<code,{code,name,parent_code}> } */
export async function fetchAllProducts() {
  const ctx = await request.newContext({
    baseURL: config.baseUrl,
    storageState: config.storageStatePath,
    extraHTTPHeaders: {
      RSC: '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept-Language': 'fa-IR,fa;q=0.9',
    },
    maxRedirects: 0,
  });
  try {
    const byCode = new Map();
    const fallbacks = new Set();
    const categories = new Map();
    const keyCounts = new Map(); // how often each field appears, to notice Liateam changing its data
    let seen = 0;
    let total = null;
    for (let page = 1; page <= config.maxPages; page++) {
      if (page > 1) await sleep(jitter());
      // Next.js validates `_rsc` as a hash of the router headers we send; with none it must be empty,
      // otherwise it answers 307 -> same URL + `&_rsc`.
      const res = await ctx.get(`/categories?page=${page}&_rsc`);
      const status = res.status();
      const location = res.headers().location ?? '';
      if (status === 401 || status === 403 || (status >= 300 && status < 400 && /\/auth\//.test(location))) {
        throw new AuthError(`سشن رد شد در صفحه‌ی ${page} (HTTP ${status}${location ? ' -> ' + location : ''})`);
      }
      if (status !== 200) throw new Error(`HTTP ${status} در /categories?page=${page}${location ? ' -> ' + location : ''}`);

      const text = await res.text();
      const parsed = parseCategoriesPage(text, page);
      // Category names ride along in the same payload; no extra request to the supplier.
      for (const [code, c] of parseCategories(text)) if (!categories.has(code)) categories.set(code, c);
      // Logged-out responses come back 200 but with pricing:null and stock capped at 20.
      if (parsed.products.every((p) => p.pricing == null)) {
        throw new AuthError(`قیمت‌ها خالی است در صفحه‌ی ${page} - سشن منقضی شده (نمای خارج از حساب)`);
      }
      total ??= parsed.total;
      if (parsed.current != null && parsed.current !== page) {
        throw new Error(`صفحه‌ی ${page} درخواست شد ولی سرور صفحه‌ی ${parsed.current} را برگرداند`);
      }
      for (const f of parsed.fallbacks) fallbacks.add(`${f.field} از مسیر جایگزین «${f.path}» (صفحه‌ی ${page})`);

      for (const raw of parsed.products) {
        seen++;
        for (const k of shapeKeys(raw)) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
        const { product, fallbacks: fb } = normalize(raw, { page }); // throws StructureError if no path works
        for (const f of fb) fallbacks.add(`${f.field} از مسیر جایگزین «${f.path}»`);
        byCode.set(product.id, product);
      }
      log.info(`page ${page}: ${parsed.products.length} products (${byCode.size}/${total})`);
      if (byCode.size >= total || parsed.products.length === 0) break;
    }
    if (fallbacks.size) log.warn('Fallback field paths used - source structure may be drifting', { fallbacks: [...fallbacks] });
    // Fields present on (almost) every product = the data contract we rely on.
    const shape = [...keyCounts].filter(([, n]) => n >= seen * 0.9).map(([k]) => k).sort();
    return { products: [...byCode.values()], total, fallbacks: [...fallbacks], categories, shape };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Reads products from their own page (cross-check + one-time audit). Per product:
 *   price / cost_price  - this product's pricing on its page
 *   prices              - distinct selling prices of every pricing block for this code (>1 = models with own prices)
 *   variantCodes        - codes listed under variant_products (sibling models)
 * Errors never fail the run (null for that product). 3–6 s pause before each page, like a person.
 * @returns {Map<code, {price, cost_price, prices: number[], variantCodes: number[]} | null>}
 */
export async function fetchProductPages(codes) {
  const ctx = await request.newContext({
    baseURL: config.baseUrl,
    storageState: config.storageStatePath,
    extraHTTPHeaders: {
      RSC: '1',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept-Language': 'fa-IR,fa;q=0.9',
    },
    maxRedirects: 0,
  });
  const out = new Map();
  try {
    for (const code of codes) {
      await sleep(3000 + Math.random() * 3000);
      try {
        const res = await ctx.get(`/products/${code}?_rsc`);
        if (res.status() !== 200) { out.set(code, null); continue; }
        const text = await res.text();
        const own = extractAll(text, 'pricing').filter((x) => x && (x.code === code || x.product_code === code));
        const variants = extractAll(text, 'variant_products').filter(Array.isArray).flat();
        out.set(code, own.length ? {
          price: Number(own[0].price),
          cost_price: Number(own[0].payable_price),
          prices: [...new Set(own.map((x) => Number(x.price)).filter(Number.isFinite))],
          variantCodes: [...new Set(variants.map((v) => v?.code ?? v?.product_code).filter((c) => typeof c === 'number' && c !== code))],
        } : null);
      } catch {
        out.set(code, null);
      }
    }
  } finally {
    await ctx.dispose();
  }
  return out;
}
