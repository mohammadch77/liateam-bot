import 'server-only';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { canStartPayment, holdLeft, parseCallbackQuery } from '@/lib/orders/payment-flow';
import type { PaymentProviderId } from '@/lib/payment/registry';
import { authorize } from '@/server/auth/guards';
import type { CurrentUser } from '@/server/services/session.service';
import { rateLimit } from '@/server/http/rate-limit';
import { orderRepository, type OrderRow } from '@/server/repositories/order.repository';
import { paymentRepository, type PaymentRow } from '@/server/repositories/payment.repository';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { withTransaction, type Queryable } from '@/server/repositories/transaction';
import { orderCommissionService } from './order-commission.service';
import { orderFlowService } from './order-flow.service';
import { paymentService } from './payment.service';
import { cartRepository } from '@/server/repositories/cart.repository';

/**
 * Paying an order (step D). The amount ALWAYS comes from the database (the order's own total_payable, copied onto the payment
 * attempt when it starts); the browser sends only an order number and a method, and the gateway's return only an authority
 * and a status. One order is confirmed once: the order row is locked while it is settled, and a unique index in the database
 * refuses a second confirmed payment, so a refreshed or doubled callback changes nothing.
 *
 * start(): pending_payment order → a gateway attempt (the buyer is sent to the gateway) or a wallet payment (ledger + settle
 *          in one transaction).
 * handleCallback(): verify with the gateway (server side), then settle; cancel / failure leave the order pending_payment so
 *          the customer can try again.
 * settle(): payment confirmed, order → queued (paid), the order's commissions, the cart closed — one transaction. After it:
 *          the SMS and the bot hand-over (order-flow.service), whose failures never undo the payment.
 */
export type PayMethod = 'gateway' | 'wallet';
export type StartResult = { kind: 'redirect'; url: string } | { kind: 'paid'; number: string };
export type CallbackResult = {
  kind: 'paid' | 'canceled' | 'failed' | 'pending' | 'unknown';
  orderNumber?: string;
  /** the same return seen again (a refresh, a second click): nothing was done twice */
  repeat?: boolean;
  message: string;
};

const MSG = {
  unknown: 'پیوند بازگشت از درگاه معتبر نیست یا به حساب شما تعلق ندارد.',
  paid: 'پرداخت با موفقیت انجام شد.',
  canceled: 'پرداخت انصراف داده شد. سفارش شما هنوز در انتظار پرداخت است و مبلغی از شما کم نشده است.',
  failed:
    'پرداخت ناموفق بود. سفارش شما هنوز در انتظار پرداخت است؛ اگر مبلغی از حساب شما کم شده، بانک آن را برمی‌گرداند.',
  pending:
    'تأیید پرداخت با درگاه ممکن نشد. چند دقیقه بعد همین صفحه را دوباره باز کنید؛ اگر پرداخت انجام شده باشد ثبت می‌شود.',
  notPending: 'این سفارش در انتظار پرداخت نیست.',
  expired: 'مهلت پرداخت این سفارش تمام شد. سبد را دوباره بررسی کنید.',
  wallet: 'موجودی کیف پول برای پرداخت این سفارش کافی نیست.',
  gatewayDown: 'اتصال به درگاه پرداخت برقرار نشد. چند لحظه بعد دوباره تلاش کنید.',
} as const;

type Settled = 'settled' | 'already' | 'duplicate' | 'unmatched' | 'failed';

/** Inside a transaction: the order row is locked, then the payment is confirmed and the order moves to queued (paid). */
async function settle(
  db: Queryable,
  orderId: string,
  paymentId: string,
  method: PayMethod,
  detail: { refId?: string; card?: string } = {},
): Promise<Settled> {
  const order = await orderRepository.lockById(orderId, db);
  const payment = await paymentRepository.findById(paymentId, db);
  if (!order || !payment) throw new AppError('NOT_FOUND');
  if (payment.status === 'confirmed') return 'already';
  if (payment.status === 'failed') return 'failed';

  const other = (await paymentRepository.listForOrder(orderId, db)).some(
    (p) => p.status === 'confirmed' && p.id !== paymentId,
  );
  if (other) {
    // the order was already paid by another attempt: this second payment is not counted (an operator refunds it)
    await paymentRepository.fail(paymentId, 'duplicate_payment', db);
    await orderRepository.appendEvent(orderId, 'duplicate_payment', null, { paymentId, method }, db);
    return 'duplicate';
  }
  if (order.status !== 'pending_payment') {
    // money arrived for an order that is no longer waiting for it (cancelled meanwhile): recorded, never lost
    if (!(await paymentRepository.confirm(paymentId, null, db))) return 'failed';
    await orderRepository.appendEvent(
      orderId,
      'paid_unmatched',
      null,
      { paymentId, status: order.status },
      db,
    );
    return 'unmatched';
  }

  if (!(await paymentRepository.confirm(paymentId, null, db))) return 'already';
  if (!(await orderRepository.transition(orderId, 'pending_payment', 'queued', { paidAt: true }, db)))
    throw new AppError('CONFLICT');
  await orderRepository.appendEvent(
    orderId,
    'paid',
    null,
    { method, paymentId, refId: detail.refId ?? null, card: detail.card ?? null },
    db,
  );
  await orderCommissionService.register(order, await orderRepository.items(orderId, db), db);
  if (order.review_id !== null) await cartRepository.markOrderedByReview(order.user_id, order.review_id, db);
  return 'settled';
}

/** After the commit: tell the customer and hand the order to the bot. Nothing here can undo or fail the payment. */
async function afterSettled(orderId: string, wait: boolean): Promise<void> {
  try {
    const order = await orderRepository.findById(orderId);
    if (!order) return;
    await orderFlowService.paymentConfirmed(order);
    await orderFlowService.advance(orderId, { waitMs: wait ? 6000 : 0 });
  } catch (e) {
    logger.error('order_payment.after_failed', { err: e instanceof Error ? e.message : 'unknown' });
  }
}

async function ownOrder(user: CurrentUser, number: string): Promise<OrderRow> {
  if (!/^AV-\d{4,12}$/.test(number)) throw new AppError('NOT_FOUND');
  const order = await orderRepository.findByNumberForUser(number, user.id);
  if (!order) throw new AppError('NOT_FOUND');
  return order;
}

export const orderPaymentService = {
  /** what the customer can pay with now (online: the settings are on and complete) */
  async options(userId: string): Promise<{ online: boolean; walletBalance: number }> {
    return {
      online: await paymentService.onlineAvailable(),
      walletBalance: await walletRepository.balance(userId),
    };
  },

  async start(number: string, method: PayMethod): Promise<StartResult> {
    const user = await authorize();
    rateLimit(`pay:${user.id}`, 10, 60_000);
    if (method !== 'gateway' && method !== 'wallet') throw new AppError('INVALID_DATA');
    const order = await ownOrder(user, number);
    if (!canStartPayment(order.status)) {
      // a second click after the payment went through: nothing more to do, show the paid order
      if ((await paymentRepository.listForOrder(order.id)).some((p) => p.status === 'confirmed'))
        return { kind: 'paid', number: order.number };
      throw new AppError('INVALID_DATA', { message: MSG.notPending });
    }
    if (!holdLeft(order.live_expires_at, new Date())) {
      // the live price / stock check no longer holds: the order cannot be placed with Liateam any more
      if (await orderRepository.transition(order.id, 'pending_payment', 'canceled', { canceledAt: true }))
        await orderRepository.appendEvent(order.id, 'expired', user.id, null);
      throw new AppError('INVALID_DATA', { message: MSG.expired });
    }
    const amount = order.total_payable; // from the database, never from the request
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('INVALID_DATA');

    if (method === 'wallet') return this.payWithWallet(order, amount);

    const { id: provider, gateway } = await paymentService.gateway();
    const callbackUrl = await paymentService.callbackUrl();
    const attempt = await withTransaction(async (db) => {
      await orderRepository.setPaymentMethod(order.id, 'gateway', db);
      return paymentRepository.initiate(
        {
          orderId: order.id,
          method: 'gateway',
          gateway: provider,
          amount,
          idempotencyKey: `gw:${order.id}:${randomUUID()}`,
        },
        db,
      );
    });
    let started;
    try {
      started = await gateway.request({
        amount,
        orderNo: order.number,
        callbackUrl,
        description: `سفارش ${order.number}`,
        mobile: user.phone,
      });
    } catch (e) {
      await paymentRepository.fail(attempt.id, 'request_failed');
      logger.error('order_payment.request_failed', {
        provider,
        err: e instanceof Error ? e.name : 'unknown',
      });
      throw new AppError('DB_UNAVAILABLE', { message: MSG.gatewayDown });
    }
    await paymentRepository.setGatewayRef(attempt.id, started.authority);
    await orderRepository.appendEvent(order.id, 'payment_started', user.id, {
      gateway: provider,
      paymentId: attempt.id,
    });
    return { kind: 'redirect', url: started.redirectUrl };
  },

  /** The wallet: ledger row, payment and order status in ONE transaction; a second click finds the same payment. */
  async payWithWallet(order: OrderRow, amount: number): Promise<StartResult> {
    const result = await withTransaction(async (db): Promise<Settled> => {
      // the order row first: a second click at the same moment waits here and then finds the order already paid
      const locked = await orderRepository.lockById(order.id, db);
      if (!locked || locked.status !== 'pending_payment') return 'already';
      await orderRepository.setPaymentMethod(order.id, 'wallet', db);
      const payment = await paymentRepository.initiate(
        { orderId: order.id, method: 'wallet', amount, idempotencyKey: `wallet-payment:${order.id}` },
        db,
      );
      try {
        await walletRepository.post(
          {
            userId: order.user_id,
            kind: 'order_payment',
            amount: -amount,
            idempotencyKey: `wallet:order:${order.id}`,
            orderId: order.id,
            note: order.number,
          },
          db,
        );
      } catch (e) {
        // the ledger refuses a balance below zero (and nothing else here): say so plainly
        if (e instanceof AppError && e.code === 'INVALID_DATA')
          throw new AppError('INVALID_DATA', { message: MSG.wallet });
        throw e;
      }
      return settle(db, order.id, payment.id, 'wallet');
    });
    if (result === 'settled') await afterSettled(order.id, true);
    return { kind: 'paid', number: order.number };
  },

  /** The gateway's return. Safe to repeat: the same authority gives the same answer and does nothing twice. */
  async handleCallback(
    user: CurrentUser,
    query: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<CallbackResult> {
    const q = parseCallbackQuery(query);
    if (!q.authority) return { kind: 'unknown', message: MSG.unknown };
    const payment = await paymentRepository.findByAuthority(q.authority);
    const order = payment ? await orderRepository.findById(payment.order_id) : null;
    if (!payment || !order || order.user_id !== user.id) return { kind: 'unknown', message: MSG.unknown };
    const base = { orderNumber: order.number };

    if (payment.status === 'confirmed') {
      await afterSettled(order.id, false); // idempotent: continues a hand-over that was cut short
      return { ...base, kind: 'paid', repeat: true, message: MSG.paid };
    }
    if (payment.status === 'failed')
      return {
        ...base,
        kind: payment.failure_reason === 'canceled' ? 'canceled' : 'failed',
        repeat: true,
        message: payment.failure_reason === 'canceled' ? MSG.canceled : MSG.failed,
      };

    // initiated: the customer backed out, or we ask the gateway (the amount is the one saved with the attempt, = the order's total)
    if (q.status === 'NOK') return this.finish(payment, order, 'canceled');
    if (payment.amount !== order.total_payable) {
      logger.error('order_payment.amount_mismatch', { order: order.number });
      return this.finish(payment, order, 'failed', 'amount_mismatch');
    }
    let verified;
    try {
      const gw = await paymentService.gatewayById(payment.gateway as PaymentProviderId);
      verified = await gw.verify({
        authority: q.authority,
        amount: payment.amount,
        query: { Authority: q.authority, Status: q.status ?? undefined, sim: q.sim ?? undefined },
      });
    } catch (e) {
      logger.error('order_payment.verify_threw', { err: e instanceof Error ? e.name : 'unknown' });
      return { ...base, kind: 'pending', message: MSG.pending };
    }
    if (verified.outcome === 'error') return { ...base, kind: 'pending', message: MSG.pending };
    if (verified.outcome === 'canceled') return this.finish(payment, order, 'canceled');
    if (verified.outcome !== 'paid') return this.finish(payment, order, 'failed', 'verify_failed');

    const settled = await withTransaction((db) =>
      settle(db, order.id, payment.id, 'gateway', { refId: verified.refId, card: verified.cardMasked }),
    );
    if (settled === 'settled') await afterSettled(order.id, true);
    return {
      ...base,
      kind: 'paid',
      repeat: settled !== 'settled',
      message:
        settled === 'duplicate'
          ? 'این سفارش قبلاً پرداخت شده است؛ مبلغ اضافه توسط پشتیبانی بازگردانده می‌شود.'
          : MSG.paid,
    };
  },

  /** the attempt ends without payment; the order stays pending_payment (a new attempt is one click) */
  async finish(
    payment: PaymentRow,
    order: OrderRow,
    kind: 'canceled' | 'failed',
    reason: string = kind,
  ): Promise<CallbackResult> {
    if (await paymentRepository.fail(payment.id, reason))
      await orderRepository.appendEvent(
        order.id,
        kind === 'canceled' ? 'payment_canceled' : 'payment_failed',
        order.user_id,
        {
          paymentId: payment.id,
          reason,
        },
      );
    return { kind, orderNumber: order.number, message: kind === 'canceled' ? MSG.canceled : MSG.failed };
  },
};
