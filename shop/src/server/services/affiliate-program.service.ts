import 'server-only';
import {
  computePurchaseProgress,
  computeSalesTierProgress,
  sanitizeTiers,
  type AffiliateTier,
  type PurchaseProgress,
  type SalesTierProgress,
} from '@/lib/affiliate/tiers';
import { AppError } from '@/lib/errors';
import { normalizeMobile, toLatinDigits } from '@/lib/phone';
import type { RequestMeta } from '@/server/http/request';
import {
  affiliateProgramRepository,
  type AffiliateGlobalConfigRow,
  type ManagedAffiliateUserRow,
} from '@/server/repositories/affiliate-program.repository';
import { auditRepository } from '@/server/repositories/audit.repository';
import { type Queryable, withTransaction } from '@/server/repositories/transaction';
import { userRepository } from '@/server/repositories/user.repository';

export type EffectiveAffiliatePolicy = {
  joinMinMonthlyToman: number;
  activeMinMonthlyToman: number;
  tiers: AffiliateTier[];
  joinIsCustom: boolean;
  activeIsCustom: boolean;
  tiersIsCustom: boolean;
  note: string | null;
};

export type AffiliateProgressView = {
  maintenance: PurchaseProgress;
  sales: SalesTierProgress;
};

function parseAmount(raw: unknown, label: string, allowEmpty = false): number | null {
  const s = toLatinDigits(String(raw ?? '')).replace(/[,٬\s_]/g, '').trim();
  if (!s) {
    if (allowEmpty) return null;
    throw new AppError('INVALID_DATA', { message: `${label} را وارد کنید.` });
  }
  if (!/^\d{1,12}$/.test(s)) {
    throw new AppError('INVALID_DATA', { message: `${label} باید یک عدد صحیح غیرمنفی باشد.` });
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0 || n > 100_000_000_000) {
    throw new AppError('INVALID_DATA', { message: `${label} خارج از محدوده‌ی مجاز است.` });
  }
  return n;
}

function parseTiersJson(raw: unknown, allowEmpty = false): AffiliateTier[] | null {
  const s = String(raw ?? '').trim();
  if (!s) {
    if (allowEmpty) return null;
    throw new AppError('INVALID_DATA', { message: 'حداقل یک سطح فروش تعریف کنید.' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    throw new AppError('INVALID_DATA', { message: 'فرمت پله‌های سطح فروش معتبر نیست.' });
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError('INVALID_DATA', { message: 'حداقل یک سطح فروش تعریف کنید.' });
  }
  const tiers: AffiliateTier[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const title = String(rec.title ?? '').trim().slice(0, 40);
    const minRaw = toLatinDigits(String(rec.minSalesToman ?? '0')).replace(/[,٬\s_]/g, '');
    const pctRaw = toLatinDigits(String(rec.commissionPercent ?? '0')).replace(/[,٬\s]/g, '');
    const minSalesToman = Number(minRaw);
    const commissionPercent = Number(pctRaw);
    if (!title) throw new AppError('INVALID_DATA', { message: 'عنوان هر سطح فروش الزامی است.' });
    if (!Number.isFinite(minSalesToman) || minSalesToman < 0) {
      throw new AppError('INVALID_DATA', { message: `حداقل فروش سطح «${title}» معتبر نیست.` });
    }
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
      throw new AppError('INVALID_DATA', { message: `درصد پورسانت سطح «${title}» باید بین ۰ تا ۱۰۰ باشد.` });
    }
    tiers.push({
      title,
      minSalesToman: Math.trunc(minSalesToman),
      commissionPercent: Math.round(commissionPercent * 100) / 100,
    });
  }
  if (!tiers.length) throw new AppError('INVALID_DATA', { message: 'حداقل یک سطح فروش معتبر وارد کنید.' });
  return sanitizeTiers(tiers);
}

export const affiliateProgramService = {
  async getGlobalConfig(db?: Queryable): Promise<AffiliateGlobalConfigRow> {
    return affiliateProgramRepository.getGlobal(db);
  },

  async policyForUser(userId: string, db?: Queryable): Promise<EffectiveAffiliatePolicy> {
    const [global, override] = await Promise.all([
      affiliateProgramRepository.getGlobal(db),
      affiliateProgramRepository.getOverride(userId, db),
    ]);
    return {
      joinMinMonthlyToman: override?.join_min_monthly_toman ?? global.join_min_monthly_toman,
      activeMinMonthlyToman: override?.active_min_monthly_toman ?? global.active_min_monthly_toman,
      tiers: override?.tiers ?? global.tiers,
      joinIsCustom: override?.join_min_monthly_toman !== null && override?.join_min_monthly_toman !== undefined,
      activeIsCustom: override?.active_min_monthly_toman !== null && override?.active_min_monthly_toman !== undefined,
      tiersIsCustom: override?.tiers !== null && override?.tiers !== undefined,
      note: override?.note ?? null,
    };
  },

  /** Monthly personal purchase eligibility gate before a regular customer can apply to become an affiliate. */
  async eligibilityFor(userId: string, db?: Queryable): Promise<PurchaseProgress> {
    const [policy, personal] = await Promise.all([
      this.policyForUser(userId, db),
      affiliateProgramRepository.monthlyPersonalPurchase(userId, db),
    ]);
    return computePurchaseProgress(personal, policy.joinMinMonthlyToman, policy.joinIsCustom);
  },

  /** Active affiliate progress: monthly personal maintenance quota + progressive referred sales tier steps. */
  async progressForAffiliate(userId: string, db?: Queryable): Promise<AffiliateProgressView> {
    const [policy, personal, sales] = await Promise.all([
      this.policyForUser(userId, db),
      affiliateProgramRepository.monthlyPersonalPurchase(userId, db),
      affiliateProgramRepository.monthlyReferredSales(userId, db),
    ]);
    return {
      maintenance: computePurchaseProgress(personal, policy.activeMinMonthlyToman, policy.activeIsCustom),
      sales: computeSalesTierProgress(sales, policy.tiers, policy.tiersIsCustom),
    };
  },

  async saveGlobalConfig(
    adminId: string,
    input: { joinMinMonthlyToman: unknown; activeMinMonthlyToman: unknown; tiersJson: unknown },
    meta: RequestMeta,
  ): Promise<void> {
    const joinMinMonthlyToman = parseAmount(input.joinMinMonthlyToman, 'سقف خرید ماهانه برای عضویت', false)!;
    const activeMinMonthlyToman = parseAmount(input.activeMinMonthlyToman, 'حداقل خرید ماهانه همکار', false)!;
    const tiers = parseTiersJson(input.tiersJson, false)!;

    await withTransaction(async (db) => {
      await affiliateProgramRepository.saveGlobal({ joinMinMonthlyToman, activeMinMonthlyToman, tiers }, adminId, db);
      await auditRepository.record(
        {
          actorUserId: adminId,
          action: 'setting.update',
          entityType: 'affiliate_global_config',
          entityId: '1',
          meta: { joinMinMonthlyToman, activeMinMonthlyToman, tiersCount: tiers.length },
          ip: meta.ip,
        },
        db,
      );
    });
  },

  async saveUserOverride(
    adminId: string,
    input: {
      userId?: string;
      phone?: string;
      joinMinMonthlyToman: unknown;
      activeMinMonthlyToman: unknown;
      useCustomTiers: boolean;
      tiersJson: unknown;
      note?: unknown;
    },
    meta: RequestMeta,
  ): Promise<{ userId: string }> {
    let targetUserId = input.userId?.trim() || '';
    if (!targetUserId) {
      const phone = normalizeMobile(String(input.phone ?? ''));
      if (!phone) {
        throw new AppError('INVALID_DATA', { message: 'شماره موبایل کاربر معتبر نیست.' });
      }
      const user = await userRepository.findLiveByPhone(phone);
      if (!user) {
        throw new AppError('NOT_FOUND', { message: 'کاربری با این شماره موبایل پیدا نشد.' });
      }
      targetUserId = user.id;
    }

    const joinMinMonthlyToman = parseAmount(input.joinMinMonthlyToman, 'سقف خرید عضویت', true);
    const activeMinMonthlyToman = parseAmount(input.activeMinMonthlyToman, 'حداقل خرید ماهانه همکار', true);
    const tiers = input.useCustomTiers ? parseTiersJson(input.tiersJson, false) : null;
    const note = String(input.note ?? '').trim().slice(0, 300) || null;

    await withTransaction(async (db) => {
      await affiliateProgramRepository.saveOverride(
        targetUserId,
        { joinMinMonthlyToman, activeMinMonthlyToman, tiers, note },
        adminId,
        db,
      );
      await auditRepository.record(
        {
          actorUserId: adminId,
          action: 'setting.update',
          entityType: 'affiliate_user_override',
          entityId: targetUserId,
          meta: {
            joinMinMonthlyToman,
            activeMinMonthlyToman,
            customTiers: tiers ? tiers.length : null,
          },
          ip: meta.ip,
        },
        db,
      );
    });

    return { userId: targetUserId };
  },

  async resetUserOverride(adminId: string, userId: string, meta: RequestMeta): Promise<void> {
    if (!/^\d+$/.test(userId)) throw new AppError('INVALID_DATA');
    await withTransaction(async (db) => {
      await affiliateProgramRepository.deleteOverride(userId, db);
      await auditRepository.record(
        {
          actorUserId: adminId,
          action: 'setting.update',
          entityType: 'affiliate_user_override',
          entityId: userId,
          meta: { resetToGlobal: true },
          ip: meta.ip,
        },
        db,
      );
    });
  },

  async listManagedUsers(): Promise<ManagedAffiliateUserRow[]> {
    return affiliateProgramRepository.listManagedUsers();
  },
};
