/** Pure types & calculation helpers for affiliate monthly purchase gates and progressive sales tiers. */

export type AffiliateTier = {
  title: string;
  /** Minimum monthly referred sales (in Toman) to reach this tier */
  minSalesToman: number;
  /** Commission percentage (0–100) earned at this tier */
  commissionPercent: number;
};

export const DEFAULT_JOIN_MIN_TOMAN = 2_000_000;
export const DEFAULT_ACTIVE_MIN_TOMAN = 1_000_000;

export const DEFAULT_AFFILIATE_TIERS: readonly AffiliateTier[] = [
  { title: 'برنزی', minSalesToman: 0, commissionPercent: 5 },
  { title: 'نقره‌ای', minSalesToman: 10_000_000, commissionPercent: 8 },
  { title: 'طلایی', minSalesToman: 30_000_000, commissionPercent: 12 },
  { title: 'الماس', minSalesToman: 60_000_000, commissionPercent: 15 },
];

export function sanitizeTiers(raw: unknown): AffiliateTier[] {
  if (!Array.isArray(raw)) return [...DEFAULT_AFFILIATE_TIERS];
  const valid: AffiliateTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 40) : '';
    const minSalesToman = Math.max(0, Math.trunc(Number(rec.minSalesToman) || 0));
    const commissionPercent = Math.max(0, Math.min(100, Math.round((Number(rec.commissionPercent) || 0) * 100) / 100));
    if (!title) continue;
    valid.push({ title, minSalesToman, commissionPercent });
  }
  if (!valid.length) return [...DEFAULT_AFFILIATE_TIERS];
  valid.sort((a, b) => a.minSalesToman - b.minSalesToman);
  return valid.slice(0, 8);
}

export type PurchaseProgress = {
  currentToman: number;
  requiredToman: number;
  remainingToman: number;
  percent: number;
  met: boolean;
  isCustom: boolean;
};

export function computePurchaseProgress(
  currentToman: number,
  requiredToman: number,
  isCustom: boolean,
): PurchaseProgress {
  const safeCurrent = Math.max(0, Math.trunc(currentToman));
  const safeReq = Math.max(0, Math.trunc(requiredToman));
  if (safeReq === 0) {
    return {
      currentToman: safeCurrent,
      requiredToman: 0,
      remainingToman: 0,
      percent: 100,
      met: true,
      isCustom,
    };
  }
  const remaining = Math.max(0, safeReq - safeCurrent);
  const percent = Math.min(100, Math.round((safeCurrent / safeReq) * 100));
  return {
    currentToman: safeCurrent,
    requiredToman: safeReq,
    remainingToman: remaining,
    percent,
    met: safeCurrent >= safeReq,
    isCustom,
  };
}

export type SalesTierProgress = {
  monthlySalesToman: number;
  tiers: AffiliateTier[];
  currentIndex: number;
  currentTier: AffiliateTier | null;
  nextTier: AffiliateTier | null;
  remainingToNextToman: number;
  currentCommissionPercent: number;
  /** 0–100 visual fill along the multi-step progress track */
  overallPercent: number;
  isCustom: boolean;
};

export function computeSalesTierProgress(
  monthlySalesToman: number,
  rawTiers: readonly AffiliateTier[],
  isCustom: boolean,
): SalesTierProgress {
  const sales = Math.max(0, Math.trunc(monthlySalesToman));
  const tiers = rawTiers.length ? [...rawTiers].sort((a, b) => a.minSalesToman - b.minSalesToman) : [...DEFAULT_AFFILIATE_TIERS];

  let currentIndex = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (sales >= tiers[i]!.minSalesToman) currentIndex = i;
  }

  const currentTier = currentIndex >= 0 ? tiers[currentIndex]! : null;
  const nextTier = currentIndex + 1 < tiers.length ? tiers[currentIndex + 1]! : null;
  const remainingToNextToman = nextTier ? Math.max(0, nextTier.minSalesToman - sales) : 0;

  let overallPercent = 0;
  if (tiers.length === 1) {
    overallPercent = tiers[0]!.minSalesToman <= 0 ? 100 : Math.min(100, Math.round((sales / tiers[0]!.minSalesToman) * 100));
  } else if (currentIndex >= tiers.length - 1) {
    overallPercent = 100;
  } else if (currentIndex < 0) {
    const firstTarget = Math.max(1, tiers[0]!.minSalesToman);
    overallPercent = Math.min(100, Math.round((sales / firstTarget) * (100 / tiers.length)));
  } else {
    const segSize = 100 / (tiers.length - 1);
    const segStart = tiers[currentIndex]!.minSalesToman;
    const segEnd = nextTier!.minSalesToman;
    const span = Math.max(1, segEnd - segStart);
    const inSeg = Math.max(0, Math.min(1, (sales - segStart) / span));
    overallPercent = Math.min(100, Math.round((currentIndex + inSeg) * segSize));
  }

  return {
    monthlySalesToman: sales,
    tiers,
    currentIndex,
    currentTier,
    nextTier,
    remainingToNextToman,
    currentCommissionPercent: currentTier?.commissionPercent ?? 0,
    overallPercent,
    isCustom,
  };
}
