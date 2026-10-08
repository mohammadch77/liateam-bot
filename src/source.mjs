// Reads all products from the paginated /categories RSC payload using the saved session.
import { request } from 'playwright';
import { config } from './config.mjs';
import { log } from './logger.mjs';
import { parseCategoriesPage } from './rsc.mjs';
import { normalize } from './normalize.mjs';
import { AuthError } from './auth.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => config.delayMinMs + Math.random() * (config.delayMaxMs - config.delayMinMs);

/** @returns { products: normalized[], total, fallbacks: string[] } */
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

      const parsed = parseCategoriesPage(await res.text(), page);
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
        const { product, fallbacks: fb } = normalize(raw, { page }); // throws StructureError if no path works
        for (const f of fb) fallbacks.add(`${f.field} از مسیر جایگزین «${f.path}»`);
        byCode.set(product.id, product);
      }
      log.info(`page ${page}: ${parsed.products.length} products (${byCode.size}/${total})`);
      if (byCode.size >= total || parsed.products.length === 0) break;
    }
    if (fallbacks.size) log.warn('Fallback field paths used - source structure may be drifting', { fallbacks: [...fallbacks] });
    return { products: [...byCode.values()], total, fallbacks: [...fallbacks] };
  } finally {
    await ctx.dispose();
  }
}
