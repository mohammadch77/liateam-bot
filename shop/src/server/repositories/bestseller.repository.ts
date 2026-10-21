import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { BestsellerCandidate, BestsellerTabKey } from '@/lib/bestsellers';

/**
 * «پرفروش‌ترین‌ها»: the admin's picks (shop schema, bestseller_picks), the candidates of a tab (visible, in stock,
 * in the tab's categories or picked) with Liateam's tags (public.product_tags, grants 011), and site switches
 * (site_settings). No price is read here.
 */

const VISIBLE = `p.is_sellable AND p.price > 0 AND p.missing_since IS NULL`;

export type PickRow = {
  id: number;
  tab_key: BestsellerTabKey;
  product_id: number;
  sort_order: number;
  enabled: boolean;
};

let tagsReady: { ok: boolean; at: number } | null = null;
async function canReadTags(): Promise<boolean> {
  if (tagsReady && (tagsReady.ok || Date.now() - tagsReady.at < 5 * 60_000)) return tagsReady.ok;
  const row = await queryOne<{ ok: boolean }>(
    'bestseller.tags_ready',
    `SELECT to_regclass('public.product_tags') IS NOT NULL
        AND has_table_privilege('public.product_tags', 'SELECT') AS ok`,
  );
  const ok = !!row?.ok;
  if (!ok && !tagsReady)
    logger.warn('bestseller.tags_unavailable', { reason: 'run deploy/shop-db-roles-011-product-tags.sql' });
  tagsReady = { ok, at: Date.now() };
  return ok;
}

export const bestsellerRepository = {
  async picks(tab?: BestsellerTabKey): Promise<PickRow[]> {
    return query<PickRow>(
      'bestseller.picks',
      `SELECT id::int, tab_key, product_id, sort_order, enabled FROM bestseller_picks
        ${tab ? 'WHERE tab_key = $1' : ''} ORDER BY tab_key, enabled DESC, sort_order, id`,
      tab ? [tab] : [],
    );
  },

  /**
   * Visible, in-stock products of these categories (null = all; each code with its subtree) plus the given ids,
   * with Liateam's best-selling / popular tags (false until grants 011 is run).
   */
  async candidates(
    categories: readonly number[] | null,
    extraIds: readonly number[],
    /** only this brand's products (the header's brand menu) */
    brandCode?: number,
  ): Promise<BestsellerCandidate[]> {
    const tags = await canReadTags();
    const tag = (key: string) =>
      tags
        ? `EXISTS (SELECT 1 FROM public.product_tags t WHERE t.product_id = p.id AND t.key = '${key}')`
        : 'false';
    // only parameters the statement uses are bound (Postgres must type each one)
    const params: unknown[] = [extraIds];
    const add = (v: unknown) => `$${params.push(v)}`;
    const conditions: string[] = [];
    if (categories)
      conditions.push(`p.category && ARRAY(WITH RECURSIVE t(code) AS (SELECT unnest(${add(categories)}::int[])
           UNION SELECT c.code FROM categories c JOIN t ON c.parent_code = t.code) SELECT code FROM t)`);
    if (brandCode !== undefined) conditions.push(`p.brand_code = ${add(brandCode)}`);
    const inTab = conditions.length ? conditions.join(' AND ') : 'true';
    const rows = await query<{
      id: number;
      best_selling: boolean;
      popular: boolean;
      reviews: number;
      rating: number;
      first_seen_at: Date;
    }>(
      'bestseller.candidates',
      `SELECT p.id, ${tag('best-selling')} AS best_selling, ${tag('popular')} AS popular,
              coalesce(p.reviews_total, 0) AS reviews, coalesce(p.rating_value, 0) AS rating, p.first_seen_at
         FROM product_catalog p
        WHERE ${VISIBLE} AND p.stock > 0 AND (${inTab} OR p.id = ANY($1::int[]))`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      bestSelling: r.best_selling,
      popular: r.popular,
      reviews: r.reviews,
      rating: r.rating,
      firstSeen: r.first_seen_at,
    }));
  },

  /** Adds a pick at the end (or switches an old one back on, at the end). */
  async addPick(tab: BestsellerTabKey, productId: number, by: string, db?: Queryable): Promise<void> {
    await query(
      'bestseller.add_pick',
      `INSERT INTO bestseller_picks (tab_key, product_id, sort_order, enabled, created_by)
       VALUES ($1, $2, (SELECT coalesce(max(sort_order), 0) + 1 FROM bestseller_picks WHERE tab_key = $1), true, $3)
       ON CONFLICT (tab_key, product_id) DO UPDATE
         SET enabled = true,
             sort_order = (SELECT coalesce(max(sort_order), 0) + 1 FROM bestseller_picks WHERE tab_key = $1)`,
      [tab, productId, by],
      db,
    );
  },

  async setPickEnabled(id: number, enabled: boolean, db?: Queryable): Promise<PickRow | null> {
    return queryOne<PickRow>(
      'bestseller.set_enabled',
      `UPDATE bestseller_picks SET enabled = $2 WHERE id = $1
       RETURNING id::int, tab_key, product_id, sort_order, enabled`,
      [id, enabled],
      db,
    );
  },

  /** Swaps a pick with its neighbour above (-1) or below (+1) among the tab's enabled picks. */
  async movePick(id: number, dir: -1 | 1, db: Queryable): Promise<PickRow | null> {
    const me = await queryOne<PickRow>(
      'bestseller.get_pick',
      'SELECT id::int, tab_key, product_id, sort_order, enabled FROM bestseller_picks WHERE id = $1',
      [id],
      db,
    );
    if (!me) return null;
    const other = await queryOne<PickRow>(
      'bestseller.neighbour',
      `SELECT id::int, tab_key, product_id, sort_order, enabled FROM bestseller_picks
        WHERE tab_key = $1 AND enabled AND id <> $2 AND ${dir < 0 ? '(sort_order, id) < ($3, $2)' : '(sort_order, id) > ($3, $2)'}
        ORDER BY sort_order ${dir < 0 ? 'DESC' : 'ASC'}, id ${dir < 0 ? 'DESC' : 'ASC'} LIMIT 1`,
      [me.tab_key, me.id, me.sort_order],
      db,
    );
    if (!other) return me;
    // distinct values even when two picks shared a sort_order
    const [a, b] =
      me.sort_order === other.sort_order
        ? [other.sort_order + dir, other.sort_order]
        : [other.sort_order, me.sort_order];
    await query(
      'bestseller.reorder',
      'UPDATE bestseller_picks SET sort_order = $2 WHERE id = $1',
      [me.id, a],
      db,
    );
    await query(
      'bestseller.reorder',
      'UPDATE bestseller_picks SET sort_order = $2 WHERE id = $1',
      [other.id, b],
      db,
    );
    return me;
  },

  // ── site settings ──
  async settings(prefix: string): Promise<Map<string, unknown>> {
    const rows = await query<{ key: string; value: unknown }>(
      'settings.list',
      'SELECT key, value FROM site_settings WHERE key LIKE $1',
      [`${prefix}%`],
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  },

  async setSetting(key: string, value: unknown, by: string, db?: Queryable): Promise<void> {
    await query(
      'settings.set',
      `INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), by],
      db,
    );
  },
};
