import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { commissionPayoutKey, payoutDecision } from '@/lib/commission/payout';
import { authorize } from '@/server/auth/guards';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { commissionRepository } from '@/server/repositories/commission.repository';
import { userRepository } from '@/server/repositories/user.repository';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { smsService } from './sms.service';

/**
 * Paying commissions into the affiliate's wallet. A commission is approved and paid in ONE transaction with its row locked:
 * pending → approved → paid, one ledger row of kind «commission» whose key is the commission's id (so a second tick, a double
 * click or two processes credit it once), and the wallet row linked back (wallet_entry_id). The tick pays the automatic ones
 * whose order was sent and whose hold has passed; a rule with manual approval is paid only when an admin approves. Cancelled
 * orders cancel their pending commissions (order-flow) and a commission already paid is final: there is no clawback.
 * One commission failing never stops the rest.
 */
export type PayoutResult = 'paid' | 'skipped';

async function payOne(id: string, by: { kind: 'auto' } | { kind: 'admin'; adminId: string; ip: string | null }) {
  const out = await withTransaction(async (db) => {
    const c = await commissionRepository.lockPayable(id, db);
    if (!c) throw new AppError('NOT_FOUND');
    const verdict = payoutDecision({
      status: c.status,
      manualApproval: c.manual_approval,
      releaseAt: c.release_at,
      orderStatus: c.order_status,
      amount: c.amount,
      now: new Date(),
      by: by.kind,
    });
    if (verdict !== 'pay') return { verdict, c };
    await walletRepository.lock(c.affiliate_user_id, db);
    if (!(await commissionRepository.markApproved(c.id, by.kind === 'admin' ? by.adminId : null, db)))
      return { verdict: 'not_pending' as const, c };
    const entry = await walletRepository.post(
      {
        userId: c.affiliate_user_id,
        kind: 'commission',
        amount: c.amount,
        idempotencyKey: commissionPayoutKey(c.id),
        orderId: c.order_id,
        note: `پورسانت ${c.order_number}`,
        createdBy: by.kind === 'admin' ? by.adminId : null,
      },
      db,
    );
    if (!(await commissionRepository.transition(c.id, 'approved', 'paid', entry.entry.id, db)))
      throw new AppError('CONFLICT');
    if (by.kind === 'admin')
      await auditRepository.record(
        {
          actorUserId: by.adminId,
          action: 'commission.approve',
          entityType: 'commission',
          entityId: c.id,
          meta: { amount: c.amount },
          ip: by.ip,
        },
        db,
      );
    return { verdict: 'pay' as const, c };
  });
  if (out.verdict !== 'pay') return { verdict: out.verdict, c: out.c };
  await notifyPaid(out.c.affiliate_user_id, out.c.amount);
  return { verdict: 'pay' as const, c: out.c };
}

/** the SMS «commission paid into your wallet»; never throws */
async function notifyPaid(userId: string, amount: number): Promise<void> {
  try {
    const phone = await userRepository.phoneOf(userId);
    if (phone) await smsService.sendEvent('commission_paid', phone, { total: amount }, { userId });
  } catch (e) {
    logger.warn('commission_payout.notify_failed', { err: e instanceof Error ? e.message : 'unknown' });
  }
}

export const commissionPayoutService = {
  /**
   * The worker's step: pay the due automatic commissions, at most `limit` per run. Safe to call at any moment, any number of
   * times, from more than one process.
   */
  async payDue(limit = 50): Promise<{ paid: number; failed: number }> {
    let paid = 0;
    let failed = 0;
    for (const id of await commissionRepository.payoutCandidates(Math.min(Math.max(limit, 1), 200))) {
      try {
        if ((await payOne(id, { kind: 'auto' })).verdict === 'pay') paid += 1;
      } catch (e) {
        failed += 1;
        logger.error('commission_payout.failed', { id, err: e instanceof Error ? e.message : 'unknown' });
      }
    }
    if (paid || failed) logger.info('commission_payout.done', { paid, failed });
    return { paid, failed };
  },

  /** An admin approves (and so pays) a commission: a manual-approval one, or any pending one earlier than its release date. */
  async approve(id: string, meta: RequestMeta): Promise<{ amount: number }> {
    const admin = await authorize('admin');
    if (!/^\d{1,18}$/.test(id)) throw new AppError('NOT_FOUND');
    const r = await payOne(id, { kind: 'admin', adminId: admin.id, ip: meta.ip });
    const messages: Record<string, string> = {
      already_paid: 'این پورسانت قبلاً واریز شده است.',
      cancelled: 'این پورسانت لغو شده است.',
      not_pending: 'این پورسانت دیگر در انتظار تأیید نیست.',
      order_not_sent: 'سفارش هنوز ارسال نشده است؛ پورسانت پس از ارسال قابل تأیید است.',
      no_amount: 'مبلغ پورسانت صفر است.',
    };
    if (r.verdict !== 'pay') throw new AppError('INVALID_DATA', { message: messages[r.verdict] ?? 'تأیید ممکن نیست.' });
    return { amount: r.c.amount };
  },

  /** An admin cancels a pending / approved commission with a reason. A paid one cannot be cancelled. */
  async cancel(id: string, reason: string, meta: RequestMeta): Promise<void> {
    const admin = await authorize('admin');
    if (!/^\d{1,18}$/.test(id)) throw new AppError('NOT_FOUND');
    const why = reason.trim().replace(/\s+/g, ' ').slice(0, 300);
    if (why.length < 3) throw new AppError('INVALID_DATA', { message: 'دلیل لغو را بنویسید.' });
    await withTransaction(async (db) => {
      const c = await commissionRepository.lockPayable(id, db);
      if (!c) throw new AppError('NOT_FOUND');
      if (c.status === 'paid')
        throw new AppError('INVALID_DATA', { message: 'پورسانت واریزشده قابل لغو نیست.' });
      if (!(await commissionRepository.cancelOne(id, why, db)))
        throw new AppError('INVALID_DATA', { message: 'این پورسانت دیگر قابل لغو نیست.' });
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'commission.cancel',
          entityType: 'commission',
          entityId: id,
          meta: { amount: c.amount, reason: why },
          ip: meta.ip,
        },
        db,
      );
    });
  },
};
