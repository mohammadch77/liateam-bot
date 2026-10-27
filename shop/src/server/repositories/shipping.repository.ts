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

export const shippingRepository = {
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
