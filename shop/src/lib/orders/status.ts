/**
 * Order status machine. The same table lives in the database (order_status_can_move in migration 013, which also
 * enforces it with a trigger); tests/unit/order-status.test.ts compares the two for every pair.
 *
 *   pending_payment → queued → placing → awaiting_payment → supplier_paid → sent
 *   needs_review: a live price / stock check stopped the placing (an operator decides)
 *   refunded, canceled: final (as is sent)
 * The sync bot's statuses are mirrored, and it can move faster than the shop polls, so a forward step may skip one.
 */
export const ORDER_STATUSES = [
  'pending_payment',
  'queued',
  'placing',
  'awaiting_payment',
  'supplier_paid',
  'sent',
  'needs_review',
  'refunded',
  'canceled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const MOVES: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ['queued', 'canceled'],
  queued: ['placing', 'awaiting_payment', 'needs_review', 'refunded', 'canceled'],
  placing: ['queued', 'awaiting_payment', 'needs_review', 'refunded', 'canceled'],
  needs_review: ['queued', 'placing', 'awaiting_payment', 'refunded', 'canceled'],
  awaiting_payment: ['queued', 'supplier_paid', 'sent', 'canceled'],
  supplier_paid: ['sent', 'canceled'],
  sent: [],
  refunded: [],
  canceled: [],
};

export const isOrderStatus = (s: unknown): s is OrderStatus => ORDER_STATUSES.includes(s as OrderStatus);
export const nextStatuses = (from: OrderStatus): readonly OrderStatus[] => MOVES[from];
export const canMove = (from: OrderStatus, to: OrderStatus): boolean => MOVES[from].includes(to);
export const isFinal = (s: OrderStatus): boolean => MOVES[s].length === 0;

/** Statuses the sync bot reports (public.shop_orders.status); anything else is not mirrored. */
export const BOT_STATUSES = [
  'queued',
  'placing',
  'awaiting_payment',
  'supplier_paid',
  'sent',
  'needs_review',
  'refunded',
  'canceled',
] as const satisfies readonly OrderStatus[];
