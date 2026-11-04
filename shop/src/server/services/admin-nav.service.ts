import 'server-only';
import { logger } from '@/lib/logger';
import { NO_COUNTS, type AdminCounts } from '@/lib/admin-nav';
import { authorize } from '@/server/auth/guards';
import { affiliateRepository } from '@/server/repositories/affiliate.repository';
import { commissionRepository } from '@/server/repositories/commission.repository';
import { orderAdminRepository } from '@/server/repositories/order-admin.repository';
import { reviewRepository } from '@/server/repositories/review.repository';
import { withdrawalRepository } from '@/server/repositories/withdrawal.repository';

const safe = async (name: string, f: () => Promise<number>): Promise<number> => {
  try {
    return await f();
  } catch (e) {
    logger.error('admin_nav.count_failed', { name, err: e instanceof Error ? e.message : 'unknown' });
    return 0;
  }
};

export const adminNavService = {
  /** The numbers beside the menu items (what waits for the staff). Support sees only the orders' number. */
  async counts(isAdmin: boolean): Promise<AdminCounts> {
    await authorize('support');
    const attention = await safe('attention', () => orderAdminRepository.actionCount());
    if (!isAdmin) return { ...NO_COUNTS, attention };
    const [withdrawals, commissions, reviews, affiliates] = await Promise.all([
      safe('withdrawals', () => withdrawalRepository.pendingCount()),
      safe('commissions', () => commissionRepository.awaitingManualCount()),
      safe('reviews', () => reviewRepository.pendingCount()),
      safe('affiliates', async () => (await affiliateRepository.counts()).pending),
    ]);
    return { attention, withdrawals, commissions, reviews, affiliates };
  },
};
