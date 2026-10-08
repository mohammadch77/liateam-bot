import 'server-only';
import { q } from './db';

export const CATALOG_SQL = `SELECT id, name, price, cost_price, stock, category, category_names, is_available, is_sellable, updated_at
  FROM product_catalog ORDER BY name`;

export const getProducts = () => q(CATALOG_SQL);

// Categories that actually occur on products, with display label (#code when unnamed).
export const getCategories = () =>
  q(`SELECT x.code, COALESCE(c.name, '#' || x.code) AS label, c.name IS NULL AS unnamed, count(*)::int AS products
       FROM supplier_products p, unnest(p.category) AS x(code) LEFT JOIN categories c ON c.code = x.code
      GROUP BY x.code, c.name ORDER BY c.name NULLS LAST, x.code`);

export async function getStatus() {
  const rows = await q('SELECT key, value, updated_at FROM bot_status');
  return Object.fromEntries(rows.map((r) => [r.key, { ...r.value, updated_at: r.updated_at }]));
}

export const getSettings = async () => Object.fromEntries((await q('SELECT key, value FROM settings')).map((r) => [r.key, r.value]));
