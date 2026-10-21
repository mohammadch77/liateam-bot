import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Packs (shop schema: pack_collections, packs, pack_items) and their prices. The price comes from
 * public.shop_pack_price (deploy/shop-db-roles-010-pack-prices.sql), which alone reads the purchase prices: this file
 * sends the product ids, the items' shop total and the pack's discount, and gets the final price and a yes/no.
 */

export type PackKind = 'percent' | 'fixed_price';

export type CollectionRow = {
  id: number;
  slug: string;
  title: string;
  variant_label: string;
  active: boolean;
  sort_order: number;
};

export type PackRow = {
  id: number;
  collection_id: number;
  variant_key: string;
  variant_title: string;
  title: string;
  description: string;
  discount_kind: PackKind;
  discount_value: number;
  active: boolean;
  allow_loss: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  sort_order: number;
};

export type PackItemRow = {
  pack_id: number;
  step_label: string;
  product_id: number | null;
  sort_order: number;
};

export type CollectionInput = {
  slug: string;
  title: string;
  variantLabel: string;
  active: boolean;
  sortOrder: number;
};
export type PackInput = {
  collectionId: number;
  variantKey: string;
  variantTitle: string;
  title: string;
  description: string;
  discountKind: PackKind;
  discountValue: number;
  active: boolean;
  allowLoss: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  steps: Array<{ label: string; productId: number | null }>;
};

const COLLECTION_COLS = 'id::int, slug, title, variant_label, active, sort_order';
const PACK_COLS = `id::int, collection_id::int, variant_key, variant_title, title, description, discount_kind,
  discount_value::bigint, active, allow_loss, starts_at, ends_at, sort_order`;

let ready: { ok: boolean; at: number } | null = null;
async function hasPackFunction(): Promise<boolean> {
  if (ready && (ready.ok || Date.now() - ready.at < 5 * 60_000)) return ready.ok;
  const sig = 'public.shop_pack_price(integer[],bigint,text,bigint,numeric,boolean)';
  const row = await queryOne<{ ok: boolean }>(
    'pack.function_ready',
    `SELECT to_regprocedure('${sig}') IS NOT NULL AND has_function_privilege('${sig}', 'EXECUTE') AS ok`,
  );
  const ok = !!row?.ok;
  if (!ok && !ready)
    logger.warn('pack.prices_unavailable', { reason: 'run deploy/shop-db-roles-010-pack-prices.sql' });
  ready = { ok, at: Date.now() };
  return ok;
}

export const packRepository = {
  async collections(): Promise<CollectionRow[]> {
    return query<CollectionRow>(
      'pack.collections',
      `SELECT ${COLLECTION_COLS} FROM pack_collections ORDER BY sort_order, id`,
    );
  },

  async collectionBySlug(slug: string): Promise<CollectionRow | null> {
    return queryOne<CollectionRow>(
      'pack.collection_by_slug',
      `SELECT ${COLLECTION_COLS} FROM pack_collections WHERE slug = $1`,
      [slug],
    );
  },

  async packs(collectionId?: number): Promise<PackRow[]> {
    return query<PackRow>(
      'pack.packs',
      `SELECT ${PACK_COLS} FROM packs ${collectionId !== undefined ? 'WHERE collection_id = $1' : ''}
        ORDER BY sort_order, id`,
      collectionId !== undefined ? [collectionId] : [],
    );
  },

  async pack(id: number): Promise<PackRow | null> {
    return queryOne<PackRow>('pack.get', `SELECT ${PACK_COLS} FROM packs WHERE id = $1`, [id]);
  },

  async items(packIds: readonly number[]): Promise<PackItemRow[]> {
    if (!packIds.length) return [];
    return query<PackItemRow>(
      'pack.items',
      `SELECT pack_id::int, step_label, product_id, sort_order FROM pack_items
        WHERE pack_id = ANY($1::bigint[]) AND enabled ORDER BY pack_id, sort_order`,
      [packIds],
    );
  },

  async insertCollection(c: CollectionInput, db?: Queryable): Promise<number> {
    const row = await queryOne<{ id: number }>(
      'pack.collection_insert',
      `INSERT INTO pack_collections (slug, title, variant_label, active, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING id::int`,
      [c.slug, c.title, c.variantLabel, c.active, c.sortOrder],
      db,
    );
    return row!.id;
  },

  async updateCollection(id: number, c: CollectionInput, db?: Queryable): Promise<boolean> {
    const rows = await query(
      'pack.collection_update',
      `UPDATE pack_collections SET slug = $2, title = $3, variant_label = $4, active = $5, sort_order = $6
        WHERE id = $1 RETURNING id`,
      [id, c.slug, c.title, c.variantLabel, c.active, c.sortOrder],
      db,
    );
    return rows.length === 1;
  },

  /** Insert or replace a pack and its steps (in the caller's transaction). */
  async savePack(id: number | null, p: PackInput, by: string, db: Queryable): Promise<number> {
    const args = [
      p.collectionId,
      p.variantKey,
      p.variantTitle,
      p.title,
      p.description,
      p.discountKind,
      p.discountValue,
      p.active,
      p.startsAt,
      p.endsAt,
      p.sortOrder,
      p.allowLoss,
    ];
    let packId: number;
    if (id === null) {
      const row = await queryOne<{ id: number }>(
        'pack.insert',
        `INSERT INTO packs (collection_id, variant_key, variant_title, title, description, discount_kind,
                            discount_value, active, starts_at, ends_at, sort_order, allow_loss, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id::int`,
        [...args, by],
        db,
      );
      packId = row!.id;
    } else {
      const rows = await query(
        'pack.update',
        `UPDATE packs SET collection_id = $2, variant_key = $3, variant_title = $4, title = $5, description = $6,
                discount_kind = $7, discount_value = $8, active = $9, starts_at = $10, ends_at = $11, sort_order = $12,
                allow_loss = $13
          WHERE id = $1 RETURNING id`,
        [id, ...args],
        db,
      );
      if (rows.length !== 1) return 0;
      packId = id;
    }
    // one row per position (no DELETE for the app role): written over, later positions switched off
    for (const [i, st] of p.steps.entries()) {
      await query(
        'pack.item_upsert',
        `INSERT INTO pack_items (pack_id, step_label, product_id, sort_order, enabled) VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (pack_id, sort_order) DO UPDATE
           SET step_label = EXCLUDED.step_label, product_id = EXCLUDED.product_id, enabled = true`,
        [packId, st.label, st.productId, i],
        db,
      );
    }
    await query(
      'pack.items_trim',
      'UPDATE pack_items SET enabled = false WHERE pack_id = $1 AND sort_order >= $2',
      [packId, p.steps.length],
      db,
    );
    return packId;
  },

  async setPackActive(id: number, active: boolean, db?: Queryable): Promise<boolean> {
    const rows = await query(
      'pack.set_active',
      'UPDATE packs SET active = $2 WHERE id = $1 RETURNING id',
      [id, active],
      db,
    );
    return rows.length === 1;
  },

  /** The pack's price; null = cannot be priced (function missing, or a product without a purchase price). */
  async price(
    productIds: readonly number[],
    displayTotal: number,
    kind: PackKind,
    value: number,
    minMargin: number,
    allowLoss: boolean,
  ): Promise<{ final: number; clamped: boolean } | null> {
    if (!productIds.length || !(await hasPackFunction())) return null;
    const row = await queryOne<{ final_toman: number; clamped: boolean }>(
      'pack.price',
      'SELECT final_toman, clamped FROM public.shop_pack_price($1::int[], $2, $3, $4, $5, $6)',
      [productIds, Math.round(displayTotal), kind, Math.round(value), minMargin, allowLoss],
    );
    return row ? { final: Number(row.final_toman), clamped: row.clamped } : null;
  },
};
