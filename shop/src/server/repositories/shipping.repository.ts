import 'server-only';
import { query, type Queryable } from '@/lib/db';

/**
 * Shipping methods and their delivery times (migration 016): labels and timing only. The PRICE of shipping is always
 * Liateam's, taken from the live check; free shipping above a goods total is a setting (src/lib/shipping.ts).
 */
export type ShippingMethodRow = {
  code: string;
  label: string;
  eta_min_days: number | null;
  eta_max_days: number | null;
  /** per-province overrides: province_id null = every province */
  rules: Array<{
    province_id: number | null;
    eta_min_days: number;
    eta_max_days: number;
    note: string | null;
  }>;
};

/** the admin's view of a method: every rule, switched-off ones included */
export type ShippingMethodAdminRow = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  rules: Array<{ province_id: number | null; eta_min_days: number; eta_max_days: number; active: boolean }>;
};

export const shippingRepository = {
  async adminMethod(code: string, db?: Queryable): Promise<ShippingMethodAdminRow | null> {
    const rows = await query<ShippingMethodAdminRow>(
      'shipping.admin_method',
      `SELECT m.id::text, m.code, m.label, m.active,
              coalesce((SELECT json_agg(json_build_object('province_id', r.province_id, 'eta_min_days', r.eta_min_days,
                                                          'eta_max_days', r.eta_max_days, 'active', r.active) ORDER BY r.province_id NULLS FIRST)
                          FROM shipping_rules r WHERE r.method_id = m.id), '[]'::json) AS rules
         FROM shipping_methods m WHERE m.code = $1`,
      [code],
      db,
    );
    return rows[0] ?? null;
  },

  async updateMethod(db: Queryable, id: string, label: string, active: boolean): Promise<void> {
    await query(
      'shipping.update_method',
      `UPDATE shipping_methods SET label = $2, active = $3 WHERE id = $1`,
      [id, label, active],
      db,
    );
  },

  /** province null = every province. The app role cannot delete: a range that is cleared is switched off (active = false). */
  async upsertRule(
    db: Queryable,
    methodId: string,
    provinceId: number | null,
    minDays: number,
    maxDays: number,
    active: boolean,
  ): Promise<void> {
    await query(
      'shipping.upsert_rule',
      `INSERT INTO shipping_rules (method_id, province_id, eta_min_days, eta_max_days, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (method_id, coalesce(province_id, 0))
       DO UPDATE SET eta_min_days = EXCLUDED.eta_min_days, eta_max_days = EXCLUDED.eta_max_days, active = EXCLUDED.active`,
      [methodId, provinceId, minDays, maxDays, active],
      db,
    );
  },

  async activeMethods(db?: Queryable): Promise<ShippingMethodRow[]> {
    return query<ShippingMethodRow>(
      'shipping.methods',
      `SELECT m.code, m.label, m.eta_min_days, m.eta_max_days,
              coalesce((SELECT json_agg(json_build_object('province_id', r.province_id, 'eta_min_days', r.eta_min_days,
                                                          'eta_max_days', r.eta_max_days, 'note', r.note) ORDER BY r.province_id NULLS FIRST)
                          FROM shipping_rules r WHERE r.method_id = m.id AND r.active), '[]'::json) AS rules
         FROM shipping_methods m WHERE m.active ORDER BY m.sort_order, m.id`,
      [],
      db,
    );
  },
};
