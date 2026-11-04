import 'server-only';
import { calculateCommissions } from '@/lib/commission/engine';
import { MAX_LEVEL } from '@/lib/commission/validate';
import { logger } from '@/lib/logger';
import { commissionRepository } from '@/server/repositories/commission.repository';
import { commissionRuleRepository } from '@/server/repositories/commission-rule.repository';
import type { OrderItemRow, OrderRow } from '@/server/repositories/order.repository';
import type { Queryable } from '@/server/repositories/transaction';

/**
 * Commissions of an order, recorded when it is paid: the buyer's referral chain (up to 5 levels) goes through the pure
 * engine (src/lib/commission/engine.ts) with the rules the client entered. One row per referrer per order (the table's
 * UNIQUE (order_id, affiliate_user_id) also makes a repeat harmless), pending, with the hold days; rounding is down. With no
 * active rule, or no referrer, nothing is created and nothing fails. A cancelled or fully refunded order cancels its
 * commissions; when the order is sent each pending one gets its release date (sent + hold days). Partial refunds are not
 * handled yet.
 */
export const orderCommissionService = {
  /** Called inside the payment transaction. Returns how many commissions were recorded. */
  async register(
    order: OrderRow,
    items: readonly OrderItemRow[],
    db: Queryable,
    now: Date = new Date(),
  ): Promise<number> {
    const rules = (await commissionRuleRepository.list(db)).filter((r) => r.active);
    if (!rules.length) return 0;
    // one level: only the buyer's own referrer earns (older rules for a higher level never match a chain of one)
    const chain = await commissionRepository.referralChain(order.user_id, MAX_LEVEL, db);
    if (!chain.length) return 0;
    const facts = await commissionRepository.lineFacts(
      items.map((i) => i.product_id),
      db,
    );
    const result = calculateCommissions(
      {
        status: 'paid',
        createdAt: order.created_at,
        lines: items.map((i) => ({
          productId: i.product_id,
          brandId: facts.get(i.product_id)?.brandId ?? null,
          categoryIds: facts.get(i.product_id)?.categoryIds ?? [],
          lineTotal: i.line_total, // what the customer pays for the goods: shipping is not in an order line
        })),
      },
      rules,
      chain,
      now,
    );
    const manual = await commissionRuleRepository.manualIds(db);
    let made = 0;
    for (const it of result.items) {
      if (it.amount <= 0) continue;
      const first = rules.find((r) => String(r.id) === String(it.ruleIds[0]));
      const ok = await commissionRepository.create(
        {
          ruleKind: first?.kind ?? null,
          ruleValue: first?.value ?? null,
          orderId: order.id,
          affiliateUserId: it.affiliateUserId,
          ruleId: String(it.ruleIds[0]),
          baseAmount: it.base,
          amount: it.amount,
          level: it.level,
          holdDays: it.holdDays,
          manualApproval: it.ruleIds.some((id) => manual.has(Number(id))),
        },
        db,
      );
      if (ok) made += 1;
    }
    logger.info('commission.registered', { order: order.number, levels: made });
    return made;
  },

  async cancelFor(orderId: string, db?: Queryable): Promise<number> {
    return commissionRepository.cancelForOrder(orderId, db);
  },

  async releaseFor(orderId: string, sentAt: Date, db?: Queryable): Promise<number> {
    return commissionRepository.setReleaseForOrder(orderId, sentAt, db);
  },
};
