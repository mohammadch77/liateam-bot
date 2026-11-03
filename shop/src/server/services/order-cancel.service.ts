import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { CANCEL_MSG, canEditOrder, cancelPlanOf, cancelRefundKey } from '@/lib/orders/cancel';
import { authorize } from '@/server/auth/guards';
import { rateLimit } from '@/server/http/rate-limit';
import { botOrderRepository } from '@/server/repositories/bot-order.repository';
import { cartRepository, MAX_QUANTITY } from '@/server/repositories/cart.repository';
import { orderRepository, type OrderRow } from '@/server/repositories/order.repository';
import { withTransaction, type Queryable } from '@/server/repositories/transaction';
import { userRepository } from '@/server/repositories/user.repository';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { orderCommissionService } from './order-commission.service';
import { settingsRead } from './settings-read.service';
import { smsService } from './sms.service';

/**
 * A customer cancelling (or editing) an order. The rule: until the operator makes the final payment at Liateam, and not after
 * (lib/orders/cancel.ts holds the table). Everything happens in ONE transaction with the order row locked and the same per-order
 * advisory lock the worker takes, so the status is read and changed together: if the worker moved the order a moment ago the
 * cancel is refused with a plain message instead of being left half done.
 *
 *   pending_payment            cancelled, nothing to return
 *   queued / needs_review      the bot's queued order is stopped (shop_cancel_order, same transaction), the status machine moves to
 *                              canceled, the WHOLE payment goes to the wallet (one ledger row, key per order), pending commissions are
 *                              cancelled, an event is written; the SMS follows after the commit and can never undo it
 *   placing / awaiting_payment the bot cannot cancel an order being placed or already placed, and the bot is not changed: a
 *                              «cancel_requested» event (once) puts it under «نیازمند توجه»; no status change, no money moves
 *                              (the refund after the operator confirms is a later task)
 *   anything later             refused
 * «Edit» is the same cancel (only where it is immediate) plus the cart refilled with the same lines and a forgotten live check,
 * so the customer checks out again at the prices and stock of that moment.
 */
export type CancelOutcome = {
  kind: 'canceled' | 'requested';
  /** toman returned to the wallet (0 when nothing was paid or nothing returned yet) */
  refunded: number;
  message: string;
};

const refuse = (message: string) => new AppError('INVALID_DATA', { message });

const jobOf = (events: Awaited<ReturnType<typeof orderRepository.events>>): number | null => {
  const e = [...events].reverse().find((x) => x.kind === 'bot_create_requested');
  const id = (e?.data as { jobId?: unknown } | null)?.jobId;
  return typeof id === 'number' ? id : null;
};

/** The bot's order for this shop order, found even when the worker has not linked it yet (its create job answered). */
export async function botOrderOf(order: OrderRow, db: Queryable): Promise<number | null> {
  if (order.bot_order_id !== null) return order.bot_order_id;
  const jobId = jobOf(await orderRepository.events(order.id, db));
  if (jobId === null) return null; // nothing was ever asked of the bot
  const r = await botOrderRepository.createResult(jobId, db);
  if (!r || !r.done) throw refuse(CANCEL_MSG.busy); // the bot is creating it right now
  const botId = Number((r.result as { order_id?: unknown } | null)?.order_id);
  if (!r.ok || !Number.isInteger(botId) || botId <= 0) return null;
  await orderRepository.linkBotOrder(order.id, botId, db);
  return botId;
}

/** the same cart the customer left, back (a line already there keeps the larger quantity) and the live check forgotten */
async function refillCart(userId: string, orderId: string, db: Queryable): Promise<void> {
  const cart = await cartRepository.openForUser(userId, db);
  const have = new Map((await cartRepository.items(cart.id, db)).map((i) => [i.product_id, i.quantity]));
  for (const it of await orderRepository.items(orderId, db))
    await cartRepository.setQuantity(
      cart.id,
      it.product_id,
      Math.min(MAX_QUANTITY, Math.max(have.get(it.product_id) ?? 0, it.quantity)),
      db,
    );
  await cartRepository.setReview(cart.id, null, db);
}

/** one SMS per order (an event row says it was tried); never throws */
async function notifyCanceled(order: OrderRow): Promise<void> {
  try {
    const events = await orderRepository.events(order.id);
    if (events.some((e) => e.kind === 'sms_canceled')) return;
    const phone = (await userRepository.phoneOf(order.user_id)) ?? order.recipient_phone;
    const r = await smsService.sendEvent(
      'canceled',
      phone,
      { order_no: order.number, total: order.total_payable },
      { userId: order.user_id, orderId: order.id },
    );
    if (r !== 'skipped') await orderRepository.appendEvent(order.id, 'sms_canceled', null, { result: r });
  } catch (e) {
    logger.warn('order_cancel.notify_failed', { err: e instanceof Error ? e.message : 'unknown' });
  }
}

async function run(number: string, edit: boolean): Promise<CancelOutcome> {
  const user = await authorize();
  rateLimit(`order-cancel:${user.id}`, 10, 60_000);
  if (!/^AV-\d{4,12}$/.test(number)) throw new AppError('NOT_FOUND');
  if ((await settingsRead.get('orders.customer_cancel_enabled')) !== true) throw refuse(CANCEL_MSG.off);
  const mine = await orderRepository.findByNumberForUser(number, user.id);
  if (!mine) throw new AppError('NOT_FOUND'); // another user's number is a 404, like the page

  const done = await withTransaction(
    async (db): Promise<CancelOutcome & { order: OrderRow; paid: boolean }> => {
      if (!(await orderRepository.tryAdvanceLock(mine.id, db))) throw refuse(CANCEL_MSG.busy);
      const order = await orderRepository.lockById(mine.id, db);
      if (!order || order.user_id !== user.id) throw new AppError('NOT_FOUND');
      if (order.status === 'canceled')
        return { kind: 'canceled', refunded: 0, message: CANCEL_MSG.already, order, paid: false }; // a second click / tab
      const plan = cancelPlanOf(order.status);
      if (plan === 'none' || (edit && !canEditOrder(order.status))) throw refuse(CANCEL_MSG.tooLate);

      if (plan === 'request') {
        const added = await orderRepository.appendEventOnce(
          order.id,
          'cancel_requested',
          { status: order.status },
          db,
        );
        return {
          kind: 'requested',
          refunded: 0,
          message: added ? CANCEL_MSG.requested : CANCEL_MSG.requestedAgain,
          order,
          paid: false,
        };
      }

      let refunded = 0;
      if (plan === 'refund') {
        const botId = await botOrderOf(order, db);
        // the bot's queued order stops being placeable in the same transaction; "too late" means it was picked up meanwhile
        if (botId !== null && !(await botOrderRepository.cancelQueued(botId, db)))
          throw refuse(CANCEL_MSG.moved);
      }
      if (!(await orderRepository.transition(order.id, order.status, 'canceled', { canceledAt: true }, db)))
        throw refuse(CANCEL_MSG.moved);
      if (plan === 'refund') {
        const posted = await walletRepository.post(
          {
            userId: order.user_id,
            kind: 'refund',
            amount: order.total_payable,
            idempotencyKey: cancelRefundKey(order.id),
            orderId: order.id,
            note: order.number,
          },
          db,
        );
        refunded = posted.duplicate ? 0 : order.total_payable;
        await orderCommissionService.cancelFor(order.id, db);
      }
      await orderRepository.appendEvent(order.id, 'canceled_by_customer', user.id, { refunded, edit }, db);
      if (edit) await refillCart(user.id, order.id, db);
      return {
        kind: 'canceled',
        refunded,
        message: refunded > 0 ? CANCEL_MSG.canceledRefund : CANCEL_MSG.canceled,
        order,
        paid: plan === 'refund',
      };
    },
  );

  if (done.paid) await notifyCanceled(done.order);
  return { kind: done.kind, refunded: done.refunded, message: done.message };
}

export const orderCancelService = {
  /** Whether customers may cancel / edit at all (the admin's switch); the pages hide the buttons when it is off. */
  async enabled(): Promise<boolean> {
    return (await settingsRead.get('orders.customer_cancel_enabled')) === true;
  },

  cancel: (number: string) => run(number, false),

  /** Edit = cancel with the full refund + the cart refilled; the caller sends the customer to /cart. */
  edit: (number: string) => run(number, true),
};
