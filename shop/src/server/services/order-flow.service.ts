import 'server-only';
import { logger } from '@/lib/logger';
import { botPath, placementPlan, trackingCode } from '@/lib/orders/payment-flow';
import type { OrderStatus } from '@/lib/orders/status';
import type { SmsEventKey } from '@/lib/sms/events';
import { botOrderRepository } from '@/server/repositories/bot-order.repository';
import { orderRepository, type OrderRow } from '@/server/repositories/order.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { userRepository } from '@/server/repositories/user.repository';
import { orderCommissionService } from './order-commission.service';
import { orderSettingsService } from './order-settings.service';
import { smsService } from './sms.service';

/**
 * What happens to a PAID order after the money: it is registered in the sync bot's queue (create), placed at Liateam at once
 * when automatic placing is on and now is inside the working hours (otherwise it waits in the queue for the operator), and
 * the bot's progress is mirrored onto the shop's order through the status machine. Every step is idempotent and recorded
 * in order_events, so `advance` can run any number of times (right after payment, and again whenever the order is looked at).
 * The bot is never asked to refund: a needs_review order keeps its money and only gets an event. SMS problems never stop it.
 */
const WORKING: readonly OrderStatus[] = [
  'queued',
  'placing',
  'awaiting_payment',
  'supplier_paid',
  'needs_review',
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const jobOf = (events: Awaited<ReturnType<typeof orderRepository.events>>, kind: string): number | null => {
  const e = [...events].reverse().find((x) => x.kind === kind);
  const id = (e?.data as { jobId?: unknown } | null)?.jobId;
  return typeof id === 'number' ? id : null;
};

const NEEDS_REVIEW = 'قیمت یا موجودی تغییر کرده یا ثبت خودکار انجام نشد؛ پشتیبانی بررسی می‌کند.';

/** one SMS per order and event (an event row says it was tried); never throws */
export async function notify(
  order: OrderRow,
  event: SmsEventKey,
  values: { tracking?: string } = {},
): Promise<void> {
  try {
    const events = await orderRepository.events(order.id);
    if (events.some((e) => e.kind === `sms_${event}`)) return;
    const phone = (await userRepository.phoneOf(order.user_id)) ?? order.recipient_phone;
    const r = await smsService.sendEvent(
      event,
      phone,
      { order_no: order.number, total: order.total_payable, tracking: values.tracking ?? '' },
      { userId: order.user_id, orderId: order.id },
    );
    if (r !== 'skipped') await orderRepository.appendEvent(order.id, `sms_${event}`, null, { result: r });
  } catch (e) {
    logger.warn('order_flow.notify_failed', { event, err: e instanceof Error ? e.message : 'unknown' });
  }
}

const customerOf = (o: OrderRow) => {
  const parts = o.recipient_name.trim().split(/\s+/);
  const first = parts[0] || 'مشتری';
  return { firstName: first, lastName: parts.slice(1).join(' ') || first, mobile: o.recipient_phone };
};

export const orderFlowService = {
  /** the payment succeeded: tell the customer (kept apart so the payment flow stays small) */
  async paymentConfirmed(order: OrderRow): Promise<void> {
    await notify(order, 'payment_ok');
  },

  /**
   * Moves a paid order as far as it can go now. `waitMs` lets the caller wait a few seconds for the bot's answer to the
   * create job (right after payment); later calls just look. Returns the order as it is afterwards.
   */
  async advance(orderId: string, opts: { waitMs?: number } = {}): Promise<OrderRow | null> {
    return (await this.advanceLocked(orderId, opts)).order;
  },

  /**
   * advance() under a per-order lock: two runs at once (two ticks, a tick and someone looking at the page) never move the same
   * order twice; the one that finds it locked returns at once with `ran: false`.
   */
  async advanceLocked(
    orderId: string,
    opts: { waitMs?: number } = {},
  ): Promise<{ ran: boolean; order: OrderRow | null }> {
    return withTransaction(async (db) => {
      if (!(await orderRepository.tryAdvanceLock(orderId, db)))
        return { ran: false, order: await orderRepository.findById(orderId) };
      return { ran: true, order: await run(orderId, opts) };
    });
  },
};

/** A. the bot's order exists for this payment (one create job per review; asking again returns it) */
async function create(order: OrderRow, waitMs: number): Promise<OrderRow> {
  if (order.bot_order_id !== null || order.status !== 'queued') return order;
  const events = await orderRepository.events(order.id);
  let jobId = jobOf(events, 'bot_create_requested');
  if (jobId === null) {
    if (order.review_id === null) return failCreate(order, 'no_review');
    jobId = await botOrderRepository.enqueueCreate(order.review_id, customerOf(order), {
      provinceId: order.province_id,
      cityId: order.city_id,
      postalCode: order.postal_code,
      address: order.line,
      plate: order.plate,
      unit: order.unit,
    });
    await orderRepository.appendEvent(order.id, 'bot_create_requested', null, { jobId });
  }
  const until = Date.now() + waitMs;
  let r = await botOrderRepository.createResult(jobId);
  while (r && !r.done && Date.now() < until) {
    await sleep(300);
    r = await botOrderRepository.createResult(jobId);
  }
  if (!r || !r.done) return order; // the bot has not answered yet: the next look continues
  const botId = Number((r.result as { order_id?: unknown } | null)?.order_id);
  if (!r.ok || !Number.isInteger(botId) || botId <= 0) return failCreate(order, 'bot_refused');
  if (await orderRepository.linkBotOrder(order.id, botId)) {
    await orderRepository.appendEvent(order.id, 'bot_linked', null, { botOrderId: botId });
    const linked = (await orderRepository.findById(order.id)) ?? order;
    await notify(linked, 'order_placed');
    return linked;
  }
  return (await orderRepository.findById(order.id)) ?? order;
}

/** The bot could not make the order (e.g. the check expired while the customer was paying): a person decides; no refund here. */
async function failCreate(order: OrderRow, why: string): Promise<OrderRow> {
  if (
    await orderRepository.transition(order.id, 'queued', 'needs_review', { needsReviewReason: NEEDS_REVIEW })
  ) {
    await orderRepository.appendEvent(order.id, 'bot_create_failed', null, { why });
    const moved = (await orderRepository.findById(order.id)) ?? order;
    await notify(moved, 'needs_review');
    return moved;
  }
  return (await orderRepository.findById(order.id)) ?? order;
}

/** B. place at Liateam now, or wait (automatic placing off / outside the hours) in the queue for the operator */
async function place(order: OrderRow): Promise<void> {
  if (order.status !== 'queued' || order.bot_order_id === null) return;
  const events = await orderRepository.events(order.id);
  if (events.some((e) => e.kind === 'place_requested')) return;
  const settings = await orderSettingsService.get();
  const plan = placementPlan(settings, new Date());
  if (plan !== 'place_now') {
    if (!events.some((e) => e.kind === 'waiting_for_placement'))
      await orderRepository.appendEvent(order.id, 'waiting_for_placement', null, { reason: plan });
    return;
  }
  try {
    // expected_total = Liateam's own total the customer was shown; the bot stops the order when it moved more than the tolerance
    const jobId = await botOrderRepository.enqueuePlace(
      order.bot_order_id,
      order.live_total ?? 0,
      settings.priceToleranceToman,
    );
    await orderRepository.appendEvent(order.id, 'place_requested', null, { jobId });
  } catch (e) {
    logger.warn('order_flow.place_enqueue_failed', {
      order: order.number,
      err: e instanceof Error ? e.message : 'unknown',
    });
  }
}

/** C. the bot's status, tracking and line statuses onto the shop's order (status only along the machine) */
async function mirror(order: OrderRow): Promise<OrderRow | null> {
  const botId = order.bot_order_id!;
  const [bot] = await botOrderRepository.orders([botId]);
  if (!bot) return order;
  let current: OrderRow = order;
  for (const to of botPath(order.status, bot.status)) {
    const moved = await orderRepository.transition(current.id, current.status, to, {
      placedAt: !!bot.placed_at || to === 'awaiting_payment',
      supplierPaidAt: !!bot.supplier_paid_at || to === 'supplier_paid',
      sentAt: !!bot.sent_at || to === 'sent',
      canceledAt: to === 'canceled',
      needsReviewReason: to === 'needs_review' ? NEEDS_REVIEW : null,
    });
    if (!moved) break; // someone else moved it first
    await orderRepository.appendEvent(current.id, 'status', null, { from: current.status, to });
    current = (await orderRepository.findById(current.id)) ?? current;
  }
  if (bot.tracking !== null && bot.tracking !== undefined)
    await orderRepository.setTracking(current.id, bot.tracking);
  for (const it of await botOrderRepository.orderItems([botId]))
    if (it.status === 'refunded')
      await orderRepository.setItemBotStatus(current.id, it.product_id, 'refunded');

  if (current.status !== order.status) {
    if (current.status === 'needs_review') await notify(current, 'needs_review');
    if (current.status === 'sent') {
      await orderCommissionService.releaseFor(current.id, current.sent_at ?? new Date());
      await notify(current, 'shipped', { tracking: trackingCode(bot.tracking) });
    }
    if (current.status === 'canceled' || current.status === 'refunded') {
      await orderCommissionService.cancelFor(current.id);
      await notify(current, 'canceled');
    }
  }
  return current;
}

/** the steps themselves (create, place, mirror), called with the order's lock held */
async function run(orderId: string, opts: { waitMs?: number }): Promise<OrderRow | null> {
  let order = await orderRepository.findById(orderId);
  if (!order || !WORKING.includes(order.status)) return order;
  try {
    order = await create(order, opts.waitMs ?? 0);
    if (order.bot_order_id !== null) {
      await place(order);
      order = (await mirror(order)) ?? order;
    }
  } catch (e) {
    logger.error('order_flow.advance_failed', {
      order: order.number,
      err: e instanceof Error ? e.message : 'unknown',
    });
  }
  return (await orderRepository.findById(orderId)) ?? order;
}
