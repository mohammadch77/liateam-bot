import 'server-only';
import { authorize } from '@/server/auth/guards';
import { commissionRepository, type CommissionStatus } from '@/server/repositories/commission.repository';

/** The admin's view of every commission (admins only, checked here too): a page with its sum, the counts, and how many wait for approval. */
export const ADMIN_COMMISSIONS_PER_PAGE = 30;

export const commissionAdminService = {
  async list(status: CommissionStatus | null, phone: string | null, page: number) {
    await authorize('admin');
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const [r, counts] = await Promise.all([
      commissionRepository.adminPage({ status, phone }, ADMIN_COMMISSIONS_PER_PAGE, (p - 1) * ADMIN_COMMISSIONS_PER_PAGE),
      commissionRepository.adminCounts(),
    ]);
    return { rows: r.rows, total: r.total, sum: r.sum, counts, page: p };
  },

  /** With no usable rule an affiliate's order makes NO commission: the admin is told (nothing is invented for them). */
  async noUsableRule(): Promise<boolean> {
    await authorize('admin');
    return (await commissionRepository.usableRuleCount()) === 0;
  },

  /** commissions of manual-approval rules, their order sent, waiting for an admin: shown under «نیازمند توجه» */
  async awaitingManual(): Promise<number> {
    await authorize('admin');
    return commissionRepository.awaitingManualCount();
  },
};
