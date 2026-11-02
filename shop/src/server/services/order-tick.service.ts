import 'server-only';
import { logger } from '@/lib/logger';
import { runTick, stuckCutoff, type TickResult } from '@/lib/orders/tick';
import { orderRepository } from '@/server/repositories/order.repository';
import { siteSettingsRepository } from '@/server/repositories/site-settings.repository';
import { withTransaction } from '@/server/repositories/transaction';
import { orderFlowService } from './order-flow.service';
import { settingsRead } from './settings-read.service';
import { smsService } from './sms.service';

/**
 * The background worker's job (called by POST /api/internal/tick, which a timer hits every minute): move every paid,
 * not-final order one step further WITHOUT anyone looking at its page, exactly the step a look at the page runs
 * (orderFlowService.advance: create at the bot, place when auto-place is on and inside the hours, mirror the bot's status), then
 * notice the orders that wait too long.
 *
 *  - each order is advanced under its own advisory lock, so two ticks (or a tick and a page view) never move one twice;
 *  - one order's failure is logged with its number only and the rest go on;
 *  - at most `limit` orders and `budgetMs` per run; a cursor in site_settings (system.tick_cursor) makes the next run continue
 *    where this one stopped, so a long list is covered over several runs instead of the first orders starving the rest;
 *  - «waiting for auto-place» orders only move when automatic placing is on and now is inside the working hours: that decision
 *    lives in orderFlowService (placementPlan), not here.
 */
const CURSOR_KEY = 'system.tick_cursor';
const STUCK_LIMIT = 50;
let running = false;

export type TickReport = TickResult & { busy: boolean; stuckAlerts: number };

async function readCursor(): Promise<string | null> {
  try {
    const v = (await siteSettingsRepository.get([CURSOR_KEY])).get(CURSOR_KEY);
    return typeof v === 'string' && /^\d+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** an order waiting longer than the setting: ONE stuck_alert event (the database statement makes a repeat a no-op), then ONE operator SMS */
async function raiseStuckAlerts(now: Date): Promise<number> {
  const minutes = await settingsRead.get('orders.stuck_alert_minutes');
  let raised = 0;
  for (const o of await orderRepository.stuckCandidates(stuckCutoff(minutes, now), STUCK_LIMIT)) {
    try {
      const first = await withTransaction(async (db) => {
        if (!(await orderRepository.tryAdvanceLock(o.id, db))) return false;
        return orderRepository.appendEventOnce(o.id, 'stuck_alert', { minutes }, db);
      });
      if (!first) continue;
      raised += 1;
      logger.warn('order_tick.stuck', { order: o.number, minutes });
      if ((await smsService.sendOperatorAlert(o.number, o.id)) !== 'skipped')
        await orderRepository.appendEventOnce(o.id, 'stuck_sms', null);
    } catch (e) {
      logger.error('order_tick.stuck_failed', {
        order: o.number,
        err: e instanceof Error ? e.message : 'unknown',
      });
    }
  }
  return raised;
}

export const orderTickService = {
  /** Safe to call at any moment, any number of times, from more than one process. */
  async advancePendingOrders(opts: { limit?: number; budgetMs?: number } = {}): Promise<TickReport> {
    const empty: TickReport = {
      tried: 0,
      advanced: 0,
      skipped: 0,
      failed: 0,
      cursor: null,
      stoppedBy: 'done',
      busy: true,
      stuckAlerts: 0,
    };
    if (running) return empty; // this process is already ticking (another process is held back by the per-order locks)
    running = true;
    try {
      const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
      const budgetMs = Math.min(Math.max(opts.budgetMs ?? 40_000, 1000), 120_000);
      let after = await readCursor();
      let orders = await orderRepository.advanceCandidates(after, limit);
      if (!orders.length && after !== null) {
        after = null; // the end was reached last time: start again from the first
        orders = await orderRepository.advanceCandidates(null, limit);
      }
      const r = await runTick({
        orders,
        limit,
        budgetMs,
        advance: async (o) => (await orderFlowService.advanceLocked(o.id)).ran,
        onError: (o, e) =>
          logger.error('order_tick.failed', {
            order: o.number,
            err: e instanceof Error ? e.message : 'unknown',
          }),
      });
      // continue after the last order handled; at the end of the list, or when nothing was left, start over next time
      const cursor = r.stoppedBy === 'done' ? null : r.cursor;
      await siteSettingsRepository.set(CURSOR_KEY, cursor, null).catch(() => {});
      const stuckAlerts = await raiseStuckAlerts(new Date()).catch((e) => {
        logger.error('order_tick.stuck_scan_failed', { err: e instanceof Error ? e.message : 'unknown' });
        return 0;
      });
      logger.info('order_tick.done', {
        tried: r.tried,
        advanced: r.advanced,
        skipped: r.skipped,
        failed: r.failed,
        stuckAlerts,
      });
      return { ...r, busy: false, stuckAlerts };
    } finally {
      running = false;
    }
  },
};
