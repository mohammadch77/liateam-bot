import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { cancelRefundKey } from '@/lib/orders/cancel';
import {
  allowedActions,
  canDo,
  hasOpenCancelRequest,
  linkClock,
  parseText,
  parseTrackingCode,
  REFUSAL,
  reviewKindOf,
  reviewSaving,
  type OperatorAction,
  type OperatorContext,
} from '@/lib/orders/operator';
import { authorize } from '@/server/auth/guards';
import { rateLimit } from '@/server/http/rate-limit';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { botOrderRepository } from '@/server/repositories/bot-order.repository';
import { orderAdminRepository } from '@/server/repositories/order-admin.repository';
import { orderRepository, type OrderRow } from '@/server/repositories/order.repository';
import { withTransaction, type Queryable } from '@/server/repositories/transaction';
import { walletRepository } from '@/server/repositories/wallet.repository';
import { botOrderOf } from './order-cancel.service';
import { notify } from './order-flow.service';
import { orderCommissionService } from './order-commission.service';
import { orderSettingsService } from './order-settings.service';
import { settingsRead } from './settings-read.service';
import { smsService } from './sms.service';
import type { CurrentUser } from './session.service';

/**
 * The operator working an order (task J). Every action: admin only, same-origin (the caller's runAction), a rate limit, then ONE
 * transaction that locks the order row and takes the same per-order advisory lock the worker and the customer's cancel take. The
 * action's allowance is decided again from the status read UNDER the lock (lib/orders/operator.ts), so a stale page, a second tab
 * or a double click is refused or recognised as already done, never repeated. Each action writes an order_events row (with the
 * admin as actor) and an audit_log row (the order number and the facts, never a phone number or an address). Statuses move only
 * through the status machine (orderRepository.transition); money goes only to the customer's wallet, with a ledger key per
 * order, so a repeat cannot pay twice. An SMS problem never undoes anything (the SMS follows the commit).
 */
const refuse = (message: string) => new AppError('INVALID_DATA', { message });
const NUMBER = /^AV-\d{4,12}$/;

type Ctx = { db: Queryable; order: OrderRow; admin: CurrentUser; meta: RequestMeta };
export type ActionDone = { message: string };

export async function operatorContext(order: OrderRow, db?: Queryable) {
  const events = await orderRepository.events(order.id, db);
  const base: OperatorContext = {
    status: order.status,
    openCancelRequest: hasOpenCancelRequest(events),
    hasBotOrder: order.bot_order_id !== null,
    reviewKind: null,
  };
  let info = null;
  if (order.status === 'needs_review' && order.bot_order_id !== null) {
    info = await botOrderRepository.reviewInfo(order.bot_order_id, db);
    base.reviewKind = info
      ? reviewKindOf({
          reason: info.reason,
          live: info.live_total,
          expected: info.expected_total,
          missing: info.missing?.length ?? 0,
        })
      : 'unknown';
  }
  return { ctx: base, events, info };
}

async function audit(c: Ctx, action: string, meta: Record<string, unknown>) {
  await auditRepository.record(
    {
      actorUserId: c.admin.id,
      action: `order.${action}`,
      entityType: 'order',
      entityId: c.order.id,
      meta: { number: c.order.number, status: c.order.status, ...meta },
      ip: c.meta.ip,
    },
    c.db,
  );
}

/** the common frame: admin, rate limit, number, lock, then `fn` with the locked order */
async function act<T>(
  number: string,
  meta: RequestMeta,
  fn: (c: Ctx) => Promise<T>,
): Promise<T> {
  const admin = await authorize('admin');
  rateLimit(`order-operator:${admin.id}`, 40, 60_000);
  if (!NUMBER.test(number)) throw new AppError('NOT_FOUND');
  const found = await orderRepository.findByNumber(number);
  if (!found) throw new AppError('NOT_FOUND');
  return withTransaction(async (db) => {
    if (!(await orderRepository.tryAdvanceLock(found.id, db))) throw refuse(REFUSAL.busy);
    const order = await orderRepository.lockById(found.id, db);
    if (!order) throw new AppError('NOT_FOUND');
    return fn({ db, order, admin, meta });
  });
}

const placeAt = async (botId: number, expected: number, db: Queryable) => {
  const tolerance = (await orderSettingsService.get()).priceToleranceToman;
  try {
    return await botOrderRepository.enqueuePlace(botId, expected, tolerance, db);
  } catch (e) {
    // the bot's function refuses an order that is no longer waiting to be placed
    logger.warn('order_operator.place_refused', { err: e instanceof Error ? e.message : 'unknown' });
    throw refuse(REFUSAL.moved);
  }
};

async function cancelInside(c: Ctx, reason: string | null, approving: boolean) {
  const { order, db, admin } = c;
  const { ctx, events } = await operatorContext(order, db);
  if (!canDo('cancel', ctx)) throw refuse(REFUSAL.moved);
  const botId = await botOrderOf(order, db);
  if (botId !== null && !(await botOrderRepository.operatorCancel(botId, db))) throw refuse(REFUSAL.botRunning);
  if (!(await orderRepository.transition(order.id, order.status, 'canceled', { canceledAt: true }, db)))
    throw refuse(REFUSAL.moved);
  const amount = Math.max(0, order.total_payable - order.refunded_total);
  const posted = await walletRepository.post(
    {
      userId: order.user_id,
      kind: 'refund',
      amount,
      idempotencyKey: cancelRefundKey(order.id),
      orderId: order.id,
      note: order.number,
    },
    db,
  );
  const refunded = posted.duplicate ? 0 : amount;
  await orderCommissionService.cancelFor(order.id, db);
  if (hasOpenCancelRequest(events) || approving)
    await orderRepository.appendEvent(order.id, 'cancel_request_approved', admin.id, null, db);
  await orderRepository.appendEvent(
    order.id,
    'canceled_by_admin',
    admin.id,
    { refunded, reason, fromRequest: hasOpenCancelRequest(events) },
    db,
  );
  await audit(c, approving ? 'cancel_approved' : 'cancel', { from: order.status, refunded, hasReason: !!reason });
  return { refunded };
}

export const orderOperatorService = {
  /** «ثبت در لیاتیم»: the call the automatic placing makes */
  place: (number: string, meta: RequestMeta): Promise<ActionDone> =>
    act(number, meta, async (c) => {
      const { ctx } = await operatorContext(c.order, c.db);
      if (!canDo('place', ctx)) throw refuse(c.order.bot_order_id === null ? REFUSAL.noBotOrder : REFUSAL.moved);
      const jobId = await placeAt(c.order.bot_order_id!, c.order.live_total ?? 0, c.db);
      if (jobId === null) throw refuse(REFUSAL.alreadyQueued);
      await orderRepository.appendEvent(c.order.id, 'place_requested', c.admin.id, { jobId, manual: true }, c.db);
      await audit(c, 'place', { jobId });
      return { message: 'درخواست ثبت در صف ربات قرار گرفت؛ وضعیت چند لحظهٔ دیگر به‌روز می‌شود.' };
    }),

  /** «درخواست دوبارهٔ بررسی»: the bot looks at the basket again, at the price the customer was shown */
  recheck: (number: string, meta: RequestMeta): Promise<ActionDone> =>
    act(number, meta, async (c) => {
      const { ctx } = await operatorContext(c.order, c.db);
      if (!canDo('recheck', ctx)) throw refuse(REFUSAL.moved);
      const jobId = await placeAt(c.order.bot_order_id!, c.order.live_total ?? 0, c.db);
      if (jobId === null) throw refuse(REFUSAL.alreadyQueued);
      await orderRepository.appendEvent(c.order.id, 'review_rechecked', c.admin.id, { jobId }, c.db);
      await audit(c, 'recheck', { jobId });
      return { message: 'بررسی دوباره از ربات خواسته شد.' };
    }),

  /**
   * «ادامه با قیمت جدید»: only where the live Liateam total did NOT rise and nothing is missing. The bot places at the new total
   * and the saving goes to the customer's wallet (a ledger row with its own key). A rise or a missing item cannot be continued
   * (the customer has not agreed to pay more): cancel with the full refund, or ask for a new check.
   */
  continueReview: (number: string, meta: RequestMeta): Promise<ActionDone> =>
    act(number, meta, async (c) => {
      const { ctx, events, info } = await operatorContext(c.order, c.db);
      if (!canDo('continue_review', ctx) || !info || info.live_total === null) throw refuse(REFUSAL.cannotContinue);
      const given = events
        .filter((e) => e.kind === 'review_continued')
        .reduce((t, e) => t + (Number((e.data as { refunded?: unknown } | null)?.refunded) || 0), 0);
      const saving = reviewSaving(c.order.live_total, info.live_total, given, c.order.total_payable);
      const n = events.filter((e) => e.kind === 'review_continued').length + 1;
      const jobId = await placeAt(c.order.bot_order_id!, info.live_total, c.db);
      if (jobId === null) throw refuse(REFUSAL.alreadyQueued);
      let refunded = 0;
      if (saving > 0) {
        const posted = await walletRepository.post(
          {
            userId: c.order.user_id,
            kind: 'refund',
            amount: saving,
            idempotencyKey: `review-diff:${c.order.id}:${n}`,
            orderId: c.order.id,
            note: c.order.number,
          },
          c.db,
        );
        refunded = posted.duplicate ? 0 : saving;
      }
      await orderRepository.appendEvent(
        c.order.id,
        'review_continued',
        c.admin.id,
        { jobId, from: c.order.live_total, to: info.live_total, refunded },
        c.db,
      );
      await audit(c, 'review_continue', { jobId, from: c.order.live_total, to: info.live_total, refunded });
      return {
        message:
          refunded > 0
            ? 'ثبت با قیمت جدید درخواست شد و تفاوت قیمت به کیف پول مشتری برگشت.'
            : 'ثبت با قیمت جدید درخواست شد.',
      };
    }),

  /** «لغو و بازگشت کامل به کیف پول» (queued, needs_review, or placed and unpaid at Liateam) */
  cancel: (number: string, rawReason: unknown, meta: RequestMeta): Promise<ActionDone> => {
    const reason = rawReason === '' || rawReason == null ? null : parseText(rawReason, 3, 200);
    if (rawReason && reason === null) throw refuse('دلیل لغو باید ۳ تا ۲۰۰ نویسه باشد.');
    return doCancel(number, reason, false, meta);
  },

  /** «تأیید لغو» for a customer's request: the same cancel, recorded as the answer to it */
  approveCancel: (number: string, meta: RequestMeta): Promise<ActionDone> => doCancel(number, null, true, meta),

  /** «رد درخواست لغو» with a reason; the customer is told */
  rejectCancel: async (number: string, rawReason: unknown, meta: RequestMeta): Promise<ActionDone> => {
    const reason = parseText(rawReason, 3, 200);
    if (!reason) throw refuse('دلیل رد را بنویسید (۳ تا ۲۰۰ نویسه).');
    const done = await act(number, meta, async (c) => {
      const { ctx } = await operatorContext(c.order, c.db);
      if (!canDo('reject_cancel', ctx)) throw refuse(REFUSAL.moved);
      await orderRepository.appendEvent(c.order.id, 'cancel_request_rejected', c.admin.id, { reason }, c.db);
      await audit(c, 'cancel_rejected', { hasReason: true });
      return c.order;
    });
    await notify(done, 'cancel_rejected');
    return { message: 'درخواست لغو رد شد و مشتری مطلع می‌شود.' };
  },

  /** «پرداخت شد»: the payment at Liateam was made; a free-text reference is kept */
  markPaid: async (number: string, rawRef: unknown, meta: RequestMeta): Promise<ActionDone> => {
    const ref = parseText(rawRef, 3, 100);
    if (!ref) throw refuse('مرجع پرداخت را بنویسید (۳ تا ۱۰۰ نویسه).');
    const told: { order: OrderRow | null } = { order: null };
    const r = await act(number, meta, async (c) => {
      if (c.order.status === 'supplier_paid' || c.order.status === 'sent')
        return { message: 'پرداخت این سفارش قبلاً ثبت شده است.' }; // a second click / tab
      const { ctx } = await operatorContext(c.order, c.db);
      if (!canDo('mark_paid', ctx)) throw refuse(REFUSAL.moved);
      if (!(await orderRepository.transition(c.order.id, 'awaiting_payment', 'supplier_paid', { supplierPaidAt: true }, c.db)))
        throw refuse(REFUSAL.moved);
      await orderRepository.appendEvent(c.order.id, 'status', c.admin.id, { from: 'awaiting_payment', to: 'supplier_paid', manual: true }, c.db);
      await orderRepository.appendEvent(c.order.id, 'supplier_paid_manual', c.admin.id, { ref }, c.db);
      if (ctx.openCancelRequest) {
        // the order is paid at Liateam: the customer's cancel request is answered
        await orderRepository.appendEvent(
          c.order.id,
          'cancel_request_rejected',
          c.admin.id,
          { reason: 'پرداخت در لیاتیم انجام شده است' },
          c.db,
        );
        told.order = c.order;
      }
      await audit(c, 'mark_paid', { from: 'awaiting_payment', to: 'supplier_paid' });
      return { message: 'پرداخت لیاتیم ثبت شد؛ سفارش در مرحلهٔ ارسال است.' };
    });
    if (told.order) await notify(told.order, 'cancel_rejected');
    return r;
  },

  /** «ارسال شد» with the postal tracking code; the commissions are released as for any sent order */
  ship: async (number: string, rawCode: unknown, meta: RequestMeta): Promise<ActionDone> => {
    const code = parseTrackingCode(rawCode);
    if (!code) throw refuse('کد رهگیری باید ۵ تا ۴۰ نویسهٔ حرف، عدد یا خط تیره باشد.');
    const shipped: { order: OrderRow | null } = { order: null };
    const r = await act(number, meta, async (c) => {
      if (c.order.status === 'sent') return { message: 'ارسال این سفارش قبلاً ثبت شده است.' };
      const { ctx } = await operatorContext(c.order, c.db);
      if (!canDo('ship', ctx)) throw refuse(REFUSAL.moved);
      if (!(await orderRepository.transition(c.order.id, 'supplier_paid', 'sent', { sentAt: true }, c.db)))
        throw refuse(REFUSAL.moved);
      await orderRepository.setTracking(c.order.id, { code, manual: true }, c.db);
      await orderRepository.appendEvent(c.order.id, 'status', c.admin.id, { from: 'supplier_paid', to: 'sent', manual: true }, c.db);
      await orderRepository.appendEvent(c.order.id, 'shipped_manual', c.admin.id, null, c.db);
      const after = (await orderRepository.findById(c.order.id, c.db)) ?? c.order;
      await orderCommissionService.releaseFor(c.order.id, after.sent_at ?? new Date(), c.db);
      await audit(c, 'ship', { from: 'supplier_paid', to: 'sent' });
      shipped.order = after;
      return { message: 'ارسال ثبت شد و پیامک ارسال برای مشتری فرستاده می‌شود.' };
    });
    if (shipped.order) await notify(shipped.order, 'shipped', { tracking: code });
    return r;
  },

  /** «بازگشت دستی» after the supplier was paid: a note and an event; no money moves by itself */
  manualReturn: (number: string, rawText: unknown, meta: RequestMeta): Promise<ActionDone> => {
    const text = parseText(rawText, 3, 500);
    if (!text) throw refuse('توضیح بازگشت دستی را بنویسید (۳ تا ۵۰۰ نویسه).');
    return act(number, meta, async (c) => {
      const { ctx } = await operatorContext(c.order, c.db);
      if (!canDo('manual_return', ctx)) throw refuse(REFUSAL.moved);
      await orderAdminRepository.addNote(c.order.id, c.admin.id, `بازگشت دستی: ${text}`, c.db);
      await orderRepository.appendEvent(c.order.id, 'manual_return_noted', c.admin.id, null, c.db);
      await audit(c, 'manual_return', { length: text.length });
      return { message: 'بازگشت دستی یادداشت شد. هیچ مبلغی به‌صورت خودکار جابه‌جا نشد.' };
    });
  },

  /** a private note (any status); never shown to the customer */
  addNote: async (number: string, rawBody: unknown, meta: RequestMeta): Promise<ActionDone> => {
    const body = parseText(rawBody, 1, 1000);
    if (!body) throw refuse('متن یادداشت باید ۱ تا ۱۰۰۰ نویسه باشد.');
    const admin = await authorize('admin');
    rateLimit(`order-note:${admin.id}`, 30, 60_000);
    if (!NUMBER.test(number)) throw new AppError('NOT_FOUND');
    const order = await orderRepository.findByNumber(number);
    if (!order) throw new AppError('NOT_FOUND');
    await withTransaction(async (db) => {
      await orderAdminRepository.addNote(order.id, admin.id, body, db);
      await orderRepository.appendEvent(order.id, 'admin_note', admin.id, null, db);
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: 'order.note',
          entityType: 'order',
          entityId: order.id,
          meta: { number: order.number, length: body.length },
          ip: meta.ip,
        },
        db,
      );
    });
    return { message: 'یادداشت ثبت شد.' };
  },

  /** the actions an order allows right now (for the page; the service checks again under the lock) */
  async actionsFor(order: OrderRow): Promise<OperatorAction[]> {
    try {
      return allowedActions((await operatorContext(order)).ctx);
    } catch {
      return ['note'];
    }
  },

  /**
   * Called by the worker: an order waiting for payment at Liateam whose link is in its last minutes (or past its end) gets ONE
   * event and ONE operator SMS (only when the operator's number and the alert template are saved). Returns how many were raised.
   */
  async remindExpiringLinks(now = new Date()): Promise<number> {
    const [ttl, remind] = await Promise.all([
      settingsRead.get('orders.payment_link_ttl_minutes'),
      settingsRead.get('orders.payment_link_remind_minutes'),
    ]);
    const watch = await orderAdminRepository.linkWatch();
    if (!watch.length) return 0;
    const bots = new Map((await botOrderRepository.orders(watch.map((w) => w.bot_order_id))).map((b) => [b.id, b]));
    let raised = 0;
    for (const o of watch) {
      try {
        const bot = bots.get(o.bot_order_id);
        const clock = linkClock(bot?.placed_at ?? null, ttl, remind, now, bot?.status === 'awaiting_payment');
        if (clock.state !== 'expiring' && clock.state !== 'expired') continue;
        const first = await withTransaction(async (db) => {
          if (!(await orderRepository.tryAdvanceLock(o.id, db))) return false;
          return orderRepository.appendEventOnce(o.id, 'payment_link_expiring', { state: clock.state, minutes: remind }, db);
        });
        if (!first) continue;
        raised += 1;
        if ((await smsService.sendOperatorAlert(o.number, o.id)) !== 'skipped')
          await orderRepository.appendEventOnce(o.id, 'payment_link_sms', null);
      } catch (e) {
        logger.error('order_operator.link_remind_failed', {
          order: o.number,
          err: e instanceof Error ? e.message : 'unknown',
        });
      }
    }
    return raised;
  },
};

async function doCancel(number: string, reason: string | null, approving: boolean, meta: RequestMeta): Promise<ActionDone> {
  const gone: { order: OrderRow | null } = { order: null };
  const r = await act(number, meta, async (c) => {
    if (c.order.status === 'canceled') return { message: 'این سفارش قبلاً لغو شده است.' }; // a second click / tab
    const { refunded } = await cancelInside(c, reason, approving);
    gone.order = c.order;
    return {
      message: refunded > 0 ? 'سفارش لغو شد و مبلغ کامل به کیف پول مشتری برگشت.' : 'سفارش لغو شد.',
    };
  });
  if (gone.order) await notify(gone.order, 'canceled');
  return r;
}
