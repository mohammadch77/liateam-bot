import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isValidIban, normalizeIban } from '@/lib/wallet/iban';
import {
  checkWithdrawal,
  withdrawable,
  type WithdrawalStatus,
  type WithdrawSource,
} from '@/lib/wallet/withdraw';
import { authorize } from '@/server/auth/guards';
import { rateLimit } from '@/server/http/rate-limit';
import type { RequestMeta } from '@/server/http/request';
import { affiliateRepository } from '@/server/repositories/affiliate.repository';
import { auditRepository } from '@/server/repositories/audit.repository';
import { userRepository } from '@/server/repositories/user.repository';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { withdrawalRepository, type WithdrawalRow } from '@/server/repositories/withdrawal.repository';
import { withTransaction, type Queryable } from '@/server/repositories/transaction';
import type { SmsEventKey } from '@/lib/sms/events';
import { settingsRead } from './settings-read.service';
import type { CurrentUser } from './session.service';
import { smsService } from './sms.service';

/**
 * Withdrawals, for sales affiliates only (role «affiliate» AND a referral code; checked here, on the server, every time).
 * The request holds the amount in the wallet ledger at once (a negative «withdrawal» row, never below zero); a rejection or the
 * affiliate cancelling returns it with a «withdrawal_return» row; an operator pays by hand and records the bank's tracking
 * code. Every ledger row has its own key (hold / return per withdrawal), so a double click or a second tab moves money once.
 * Everything about one user's money runs under that user's wallet lock. The account number never appears in a log or an
 * audit entry, and only an admin can read it whole.
 */
const faMoney = (n: number) => new Intl.NumberFormat('fa-IR').format(n);
const refuse = (message: string) => new AppError('INVALID_DATA', { message });

export type WalletSettings = { source: WithdrawSource; min: number; max: number; singlePending: boolean };

async function settings(): Promise<WalletSettings> {
  const [source, min, max, singlePending] = await Promise.all([
    settingsRead.get('withdrawal.source'),
    settingsRead.get('withdrawal.min'),
    settingsRead.get('withdrawal.max'),
    settingsRead.get('withdrawal.single_pending'),
  ]);
  return { source, min, max: Math.max(min, max), singlePending };
}

export async function isAffiliate(user: Pick<CurrentUser, 'id' | 'roles'>): Promise<boolean> {
  return user.roles.includes('affiliate') && (await affiliateRepository.hasCode(user.id));
}

/** what may be withdrawn right now (also used by the request itself, inside its transaction) */
async function limitsFor(userId: string, s: WalletSettings, db?: Queryable) {
  const [balance, commissionIn, withdrawnActive] = await Promise.all([
    walletRepository.balance(userId, db),
    walletRepository.sumOfKind(userId, 'commission', db),
    withdrawalRepository.sumActive(userId, db),
  ]);
  return { balance, withdrawable: withdrawable({ source: s.source, balance, commissionIn, withdrawnActive }) };
}

async function notify(userId: string, event: SmsEventKey, amount: number, tracking = ''): Promise<void> {
  try {
    const phone = await userRepository.phoneOf(userId);
    if (phone) await smsService.sendEvent(event, phone, { total: amount, tracking }, { userId });
  } catch (e) {
    logger.warn('withdrawal.notify_failed', { event, err: e instanceof Error ? e.message : 'unknown' });
  }
}

export const withdrawalService = {
  /** The wallet page's money box for this user: eligibility, the withdrawable amount, the held amount and their requests. */
  async overview(user: CurrentUser) {
    const eligible = await isAffiliate(user);
    if (!eligible) return { eligible: false as const };
    const s = await settings();
    const [lim, held, items] = await Promise.all([
      limitsFor(user.id, s),
      withdrawalRepository.sumPending(user.id),
      withdrawalRepository.listForUser(user.id, 20),
    ]);
    return { eligible: true as const, settings: s, withdrawable: lim.withdrawable, held, items };
  },

  /** A withdrawal request: checks the role, the amount, the account number, the limit; holds the money. */
  async request(raw: { amount: unknown; iban: unknown; holderName: unknown }, meta: RequestMeta) {
    const user = await authorize();
    rateLimit(`withdraw-req:${user.id}`, 10, 10 * 60_000);
    if (!(await isAffiliate(user))) throw refuse('برداشت مخصوص همکاران فروش است.');
    const amount = Number(raw.amount);
    const iban = normalizeIban(String(raw.iban ?? ''));
    const holder = String(raw.holderName ?? '').trim().replace(/\s+/g, ' ');
    if (!isValidIban(iban)) throw refuse('شماره‌ی شبا معتبر نیست (IR و ۲۴ رقم).');
    if (holder.length < 2 || holder.length > 120 || /[<>]/.test(holder)) throw refuse('نام صاحب حساب را درست بنویسید.');
    const s = await settings();

    const created = await withTransaction(async (db) => {
      await walletRepository.lock(user.id, db); // the check and the hold below cannot interleave with another request
      const lim = await limitsFor(user.id, s, db);
      const verdict = checkWithdrawal({
        amount,
        min: s.min,
        max: s.max,
        withdrawable: lim.withdrawable,
        hasPending: await withdrawalRepository.hasPending(user.id, db),
        singlePending: s.singlePending,
      });
      if (!verdict.ok) {
        const m = {
          amount: 'مبلغ معتبر نیست.',
          min: `حداقل مبلغ برداشت ${faMoney(s.min)} تومان است.`,
          max: `حداکثر مبلغ هر درخواست برداشت ${faMoney(s.max)} تومان است.`,
          over: `بیشتر از مبلغ قابل برداشت (${faMoney(lim.withdrawable)} تومان) نمی‌توانید برداشت کنید.`,
          pending: 'درخواست قبلی شما هنوز در حال بررسی است؛ پس از پرداخت یا رد آن می‌توانید درخواست تازه بدهید.',
        } as const;
        throw refuse(m[verdict.reason]);
      }
      const w = await withdrawalRepository.create({ userId: user.id, amount, iban, holderName: holder }, db);
      const hold = await walletRepository.post(
        {
          userId: user.id,
          kind: 'withdrawal',
          amount: -amount,
          idempotencyKey: `withdrawal-hold:${w.id}`,
          ref: `withdrawal:${w.id}`,
          note: 'درخواست برداشت',
        },
        db,
      );
      await withdrawalRepository.setHold(w.id, hold.entry.id, db);
      await auditRepository.record(
        { actorUserId: user.id, action: 'withdrawal.request', entityType: 'withdrawal', entityId: w.id, meta: { amount }, ip: meta.ip },
        db,
      );
      return w;
    });
    await notify(user.id, 'withdrawal_requested', amount);
    return { id: created.id, amount };
  },

  /** The affiliate cancels their own pending request: the whole amount returns. Another user's id is «not found». */
  async cancel(id: string, meta: RequestMeta) {
    const user = await authorize();
    rateLimit(`withdraw-cancel:${user.id}`, 10, 10 * 60_000);
    if (!/^\d{1,18}$/.test(id)) throw new AppError('NOT_FOUND');
    const amount = await closeAndReturn(id, user.id, 'canceled', { decidedBy: user.id }, user.id, meta);
    return { amount };
  },

  /** ---- admin ---- */
  async adminList(status: WithdrawalStatus | null, page: number) {
    await authorize('admin');
    const per = 30;
    const p = Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1;
    const [rows, counts] = await Promise.all([
      withdrawalRepository.listWithIban(status, per, (p - 1) * per),
      withdrawalRepository.counts(),
    ]);
    return { rows, counts, page: p };
  },

  async pendingCount(): Promise<number> {
    await authorize('admin');
    return withdrawalRepository.pendingCount();
  },

  /** An operator paid by hand: «paid» with the bank's tracking code. */
  async markPaid(id: string, paidRef: string, meta: RequestMeta) {
    const admin = await authorize('admin');
    const ref = paidRef.trim();
    if (ref.length < 3 || ref.length > 60 || /[<>\s]/.test(ref)) throw refuse('کد پیگیری بانکی را درست وارد کنید (۳ تا ۶۰ نویسه، بدون فاصله).');
    const done = await withTransaction(async (db) => {
      const w = await lockPending(id, db);
      await walletRepository.lock(w.user_id, db);
      if (!(await withdrawalRepository.decide(id, 'paid', { decidedBy: admin.id, paidRef: ref }, db)))
        throw new AppError('CONFLICT');
      await auditRepository.record(
        { actorUserId: admin.id, action: 'withdrawal.paid', entityType: 'withdrawal', entityId: id, meta: { amount: w.amount, ref }, ip: meta.ip },
        db,
      );
      return w;
    });
    await notify(done.user_id, 'withdrawal_paid', done.amount, ref);
    return { amount: done.amount };
  },

  /** An operator rejects it with a reason: the whole amount returns. */
  async reject(id: string, reason: string, meta: RequestMeta) {
    const admin = await authorize('admin');
    const why = reason.trim().replace(/\s+/g, ' ').slice(0, 300);
    if (why.length < 3) throw refuse('دلیل رد را بنویسید.');
    const amount = await closeAndReturn(id, null, 'rejected', { decidedBy: admin.id, reason: why }, admin.id, meta);
    return { amount };
  },
};

async function lockPending(id: string, db: Queryable, userId: string | null = null) {
  if (!/^\d{1,18}$/.test(id)) throw new AppError('NOT_FOUND');
  const w = await withdrawalRepository.lock(id, userId, db);
  if (!w) throw new AppError('NOT_FOUND');
  if (w.status !== 'pending') throw refuse('این درخواست قبلاً بررسی شده است.');
  return w;
}

/** rejected / cancelled: status + the ledger return in one transaction, once (the return row has its own key) */
async function closeAndReturn(
  id: string,
  ownerId: string | null,
  to: 'rejected' | 'canceled',
  d: { decidedBy: string; reason?: string },
  actor: string,
  meta: RequestMeta,
): Promise<number> {
  const w = await withTransaction(async (db) => {
    const row = await lockPending(id, db, ownerId);
    await walletRepository.lock(row.user_id, db);
    const back = await walletRepository.post(
      {
        userId: row.user_id,
        kind: 'withdrawal_return',
        amount: row.amount,
        idempotencyKey: `withdrawal-return:${row.id}`,
        ref: `withdrawal:${row.id}`,
        note: to === 'rejected' ? 'رد درخواست برداشت' : 'لغو درخواست برداشت',
      },
      db,
    );
    if (!(await withdrawalRepository.decide(row.id, to, { ...d, returnLedgerId: back.entry.id }, db)))
      throw new AppError('CONFLICT');
    await auditRepository.record(
      {
        actorUserId: actor,
        action: `withdrawal.${to === 'rejected' ? 'reject' : 'cancel'}`,
        entityType: 'withdrawal',
        entityId: row.id,
        meta: { amount: row.amount },
        ip: meta.ip,
      },
      db,
    );
    return row;
  });
  if (to === 'rejected') await notify(w.user_id, 'withdrawal_rejected', w.amount);
  return w.amount;
}

export type { WithdrawalRow };
