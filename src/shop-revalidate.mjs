// After a run committed its changes, ask the shop to drop the cached pages that show them
// (POST /api/internal/revalidate with the shared secret). Off unless SHOP_REVALIDATE_URL and SHOP_REVALIDATE_SECRET
// are set. A few retries; a failure is only logged — it never fails or slows the sync more than a few seconds.

const LISTING_TYPES = new Set(['price_changed', 'stock_changed', 'product_added', 'product_removed', 'product_returned',
  'name_changed', 'images_changed']);

/**
 * Pages to refresh for a run's change events ({event_type, product_code}) and the products' English slugs
 * (Map code → slug_en): each changed product's page; for price/stock/catalog/photo changes also the lists that show
 * cards (home, shop, every category and brand page, search); for banners the home page.
 */
export function pathsFor(events, slugs) {
  const out = new Map();
  const add = (path, type) => out.set(`${path}|${type ?? ''}`, type ? { path, type } : { path });
  for (const e of events) {
    if (e.product_code) {
      const slug = slugs.get(e.product_code);
      if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) add(`/p/${slug}`);
      else add('/p/[slug]', 'page'); // no English slug yet: every product page
    }
    if (LISTING_TYPES.has(e.event_type)) {
      for (const p of ['/', '/shop', '/search']) add(p);
      add('/c/[slug]', 'page');
      add('/brands/[slug]', 'page');
    }
    if (e.event_type === 'banner_changed') add('/');
  }
  return [...out.values()];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the shop. @returns {{ ok: boolean, skipped?: true, attempts: number, error?: string }} — never throws.
 * `fetchImpl` / `wait` are for tests.
 */
export async function revalidateShop(paths, { env = process.env, fetchImpl = fetch, wait = sleep, attempts = 3, log } = {}) {
  const url = env.SHOP_REVALIDATE_URL;
  const secret = env.SHOP_REVALIDATE_SECRET;
  if (!url || !secret || !paths.length) return { ok: false, skipped: true, attempts: 0 };
  let error = null;
  let tried = 0;
  for (let i = 1; i <= attempts; i++) {
    tried = i;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ paths: paths.slice(0, 200) }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return { ok: true, attempts: i };
      error = `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 404 || res.status === 400) break; // wrong secret / off / bad body: retrying won't help
    } catch (e) {
      error = e.name === 'TimeoutError' ? 'timeout' : e.message;
    }
    if (i < attempts) await wait(1000 * 2 ** (i - 1)); // 1 s, 2 s
  }
  log?.warn('shop revalidate failed — the shop shows the change on its next render', { error, paths: paths.length });
  return { ok: false, attempts: tried, error };
}
