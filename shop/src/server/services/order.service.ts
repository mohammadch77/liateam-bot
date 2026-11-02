import 'server-only';
import { authorize } from '@/server/auth/guards';
import { orderRepository, type OrderItemRow, type OrderRow } from '@/server/repositories/order.repository';

/**
 * A customer's view of an order. Only the owner can read it: the number is looked up together with the user id, so
 * another user's number is simply not found. The row carries no purchase price; the supplier's shipping price and what the
 * shop absorbed are kept out of what a page shows (see the order page).
 */
export type OrderWithItems = OrderRow & { items: OrderItemRow[] };

export const orderService = {
  /** For the admin's «نیازمند توجه»: paid orders a person has to look at (stopped for review, or waiting too long). Numbers only. */
  async needingAttention(limit = 20) {
    await authorize('admin');
    return orderRepository.needingAttention(Math.min(Math.max(limit, 1), 100));
  },

  async forUser(userId: string, number: string): Promise<OrderWithItems | null> {
    if (!/^AV-\d{4,12}$/.test(number)) return null;
    const order = await orderRepository.findByNumberForUser(number, userId);
    if (!order) return null;
    return { ...order, items: await orderRepository.items(order.id) };
  },
};
