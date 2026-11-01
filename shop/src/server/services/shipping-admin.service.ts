import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { parseShippingForm, type Range } from '@/lib/shipping-rules';
import { authorize } from '@/server/auth/guards';
import { dataChanged } from '@/server/cache-events';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import type { GeoItem } from '@/server/repositories/geo.repository';
import { shippingRepository } from '@/server/repositories/shipping.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { geoService } from './geo.service';

/**
 * The admin's shipping screen: the «post» method (label, on/off) and its delivery range in working days, one range for
 * every province plus a range of its own per province, edited one by one or in bulk. The PRICE of shipping is always
 * Liateam's; this is labels and timing only. Checkout shows range + «shipping.extra_days».
 */
const CODE = 'post';

export type ShippingView = {
  label: string;
  active: boolean;
  fallback: Range | null;
  /** null when Liateam's province list could not be loaded (the bot is away): the page says so */
  provinces: Array<GeoItem & { range: Range | null }> | null;
};

const toRange = (
  r: { eta_min_days: number; eta_max_days: number; active: boolean } | undefined,
): Range | null => (r?.active ? { min: r.eta_min_days, max: r.eta_max_days } : null);
const same = (a: Range | null, b: Range | null) => a?.min === b?.min && a?.max === b?.max;

export const shippingAdminService = {
  async view(): Promise<ShippingView> {
    await authorize('admin');
    const method = await shippingRepository.adminMethod(CODE);
    if (!method)
      throw new AppError('NOT_FOUND', { message: 'روش ارسال «پست» ساخته نشده است (مایگریشن ۰۱۷).' });
    const provinces = await geoService.provinces().catch((e) => {
      logger.warn('shipping_admin.provinces_unavailable', { err: e });
      return null;
    });
    const rule = (id: number | null) => method.rules.find((r) => r.province_id === id);
    return {
      label: method.label,
      active: method.active,
      fallback: toRange(rule(null)),
      provinces: provinces?.map((p) => ({ ...p, range: toRange(rule(p.id)) })) ?? null,
    };
  },

  /** Admins only; audited with the counts and the changed ranges (no personal data). */
  async save(
    form: { get(n: string): unknown; getAll(n: string): unknown[] },
    meta: RequestMeta,
  ): Promise<number> {
    const admin = await authorize('admin');
    const method = await shippingRepository.adminMethod(CODE);
    if (!method) throw new AppError('NOT_FOUND');
    // without Liateam's list only the label, the switch and the fallback range are editable
    const provinces = await geoService.provinces().catch(() => []);
    const parsed = parseShippingForm(form, new Map(provinces.map((p) => [p.id, p.name])));
    if (!parsed.ok) throw new AppError('INVALID_DATA', { message: parsed.error });
    const input = parsed.value;
    const rule = (id: number | null) => method.rules.find((r) => r.province_id === id);

    const changes: Array<{ province: number | null; before: Range | null; after: Range | null }> = [];
    const stage = (province: number | null, after: Range | null) => {
      const before = toRange(rule(province));
      if (!same(before, after)) changes.push({ province, before, after });
    };
    stage(null, input.fallback);
    for (const p of input.provinces) stage(p.id, p.range);

    const methodChanged = method.label !== input.label || method.active !== input.active;
    if (!changes.length && !methodChanged) return 0;
    await withTransaction(async (db) => {
      if (methodChanged) await shippingRepository.updateMethod(db, method.id, input.label, input.active);
      for (const c of changes) {
        const prior = rule(c.province);
        // a cleared range keeps its last numbers and is switched off (the app role cannot delete)
        const keep = c.after ?? (prior ? { min: prior.eta_min_days, max: prior.eta_max_days } : null);
        if (keep)
          await shippingRepository.upsertRule(
            db,
            method.id,
            c.province,
            keep.min,
            keep.max,
            c.after !== null,
          );
      }
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'shipping.update',
          entityType: 'shipping_method',
          entityId: CODE,
          meta: {
            method: methodChanged ? { label: input.label, active: input.active } : undefined,
            fallback: changes.find((c) => c.province === null),
            provinces: changes.filter((c) => c.province !== null).length,
            sample: changes.filter((c) => c.province !== null).slice(0, 5),
          },
          ip: meta.ip,
        },
        db,
      );
    });
    dataChanged();
    return changes.length + (methodChanged ? 1 : 0);
  },
};
