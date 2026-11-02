import 'server-only';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { parseCallbackQuery } from '@/lib/orders/payment-flow';
import { checkTopup, presetAmounts } from '@/lib/wallet/withdraw';
import { authorize } from '@/server/auth/guards';
import { rateLimit } from '@/server/http/rate-limit';
import { paymentRepository, type PaymentRow } from '@/server/repositories/payment.repository';
import { userRepository } from '@/server/repositories/user.repository';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { withTransaction } from '@/server/repositories/transaction';
import type { CurrentUser } from '@/server/services/session.service';
import type { CallbackResult } from './order-payment.service';
import { paymentService } from './payment.service';
import { settingsRead } from './settings-read.service';
import { smsService } from './sms.service';

/**
 * Charging the wallet. The same gateway, callback page and verification as an order (payment.service); the attempt is a payment
 * row of kind «wallet_topup» with no order. The amount is chosen once, when the attempt starts, and saved in the database: the
 * gateway's return carries only an authority and a status. A confirmed top-up writes ONE ledger row whose key is the payment's id,
 * in the same transaction that confirms the payment, so a refreshed or doubled callback credits once. Money spent from the wallet
 * stays in the site: there is no withdrawal for a customer (see withdrawal.service for affiliates).
 */
const MSG = {
  paid: 'کیف پول شما شارژ شد.',
  canceled: 'پرداخت انصراف داده شد. مبلغی از شما کم نشده و کیف پول شارژ نشد.',
  failed:
    'پرداخت ناموفق بود و کیف پول شارژ نشد. اگر مبلغی از حساب شما کم شده، بانک آن را برمی‌گرداند.',
  pending:
    'تأیید پرداخت با درگاه ممکن نشد. چند دقیقه بعد همین صفحه را دوباره باز کنید؛ اگر پرداخت انجام شده باشد ثبت می‌شود.',
  unknown: 'پیوند بازگشت از درگاه معتبر نیست یا به حساب شما تعلق ندارد.',
  off: 'پرداخت آنلاین فعلاً در دسترس نیست؛ شارژ کیف پول هم ممکن نیست.',
} as const;

const faMoney = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

export const walletTopupService = {
  /** what the top-up form needs: whether online payment works now, the window the admin set, quick amounts */
  async options(): Promise<{ online: boolean; min: number; max: number; presets: number[] }> {
    const [online, min, rawMax] = await Promise.all([
      paymentService.onlineAvailable(),
      settingsRead.get('wallet.topup_min'),
      settingsRead.get('wallet.topup_max'),
    ]);
    const max = Math.max(min, rawMax);
    return { online, min, max, presets: presetAmounts(min, max) };
  },

  /** Starts a top-up: returns the gateway address to send the customer to. */
  async start(amount: number): Promise<{ url: string }> {
    const user = await authorize();
    rateLimit(`topup:${user.id}`, 5, 10 * 60_000);
    const o = await this.options();
    if (!o.online) throw new AppError('INVALID_DATA', { message: MSG.off });
    const verdict = checkTopup(amount, o.min, o.max);
    if (verdict !== 'ok') {
      throw new AppError('INVALID_DATA', {
        message:
          verdict === 'min'
            ? `حداقل مبلغ شارژ ${faMoney(o.min)} تومان است.`
            : verdict === 'max'
              ? `حداکثر مبلغ شارژ ${faMoney(o.max)} تومان است.`
              : 'مبلغ معتبر نیست.',
      });
    }
    const { id: provider, gateway } = await paymentService.gateway();
    const callbackUrl = await paymentService.callbackUrl();
    const attempt = await paymentRepository.initiateTopup({
      userId: user.id,
      gateway: provider,
      amount,
      idempotencyKey: `topup:${user.id}:${randomUUID()}`,
    });
    try {
      const started = await gateway.request({
        amount,
        orderNo: `WL-${attempt.id}`,
        callbackUrl,
        description: 'شارژ کیف پول',
        mobile: user.phone,
      });
      await paymentRepository.setGatewayRef(attempt.id, started.authority);
      return { url: started.redirectUrl };
    } catch (e) {
      await paymentRepository.fail(attempt.id, 'request_failed');
      logger.error('wallet_topup.request_failed', { provider, err: e instanceof Error ? e.name : 'unknown' });
      throw new AppError('DB_UNAVAILABLE', { message: 'اتصال به درگاه پرداخت برقرار نشد. چند لحظه بعد دوباره تلاش کنید.' });
    }
  },

  /** The gateway's return for a top-up (called by the shared callback). Safe to repeat. */
  async handleCallback(
    user: CurrentUser,
    payment: PaymentRow,
    q: ReturnType<typeof parseCallbackQuery>,
  ): Promise<CallbackResult> {
    const base = { topup: { amount: payment.amount } };
    if (payment.user_id !== user.id || !q.authority)
      return { kind: 'unknown', message: MSG.unknown };
    if (payment.status === 'confirmed') return { ...base, kind: 'paid', repeat: true, message: MSG.paid };
    if (payment.status === 'failed') {
      const canceled = payment.failure_reason === 'canceled';
      return { ...base, kind: canceled ? 'canceled' : 'failed', repeat: true, message: canceled ? MSG.canceled : MSG.failed };
    }
    const v = await paymentService.verifyAttempt(payment, { authority: q.authority, status: q.status, sim: q.sim });
    if (v.outcome === 'pending') return { ...base, kind: 'pending', message: MSG.pending };
    if (v.outcome !== 'paid') {
      const canceled = v.outcome === 'canceled';
      await paymentRepository.fail(payment.id, canceled ? 'canceled' : 'verify_failed');
      return { ...base, kind: canceled ? 'canceled' : 'failed', message: canceled ? MSG.canceled : MSG.failed };
    }
    // confirmed payment + ledger row in one transaction, the row's key being the payment: credited once however often this runs
    const first = await withTransaction(async (db) => {
      const flipped = await paymentRepository.confirm(payment.id, null, db);
      await walletRepository.post(
        {
          userId: user.id,
          kind: 'topup',
          amount: payment.amount,
          idempotencyKey: `topup-payment:${payment.id}`,
          ref: v.refId ?? null,
          note: 'شارژ کیف پول',
        },
        db,
      );
      return flipped;
    });
    if (first) await notifyTopup(user.id, payment.amount);
    return { ...base, kind: 'paid', repeat: !first, message: MSG.paid };
  },
};

/** the success SMS; never throws */
async function notifyTopup(userId: string, amount: number): Promise<void> {
  try {
    const phone = await userRepository.phoneOf(userId);
    if (phone) await smsService.sendEvent('topup_ok', phone, { total: amount }, { userId });
  } catch (e) {
    logger.warn('wallet_topup.notify_failed', { err: e instanceof Error ? e.message : 'unknown' });
  }
}
