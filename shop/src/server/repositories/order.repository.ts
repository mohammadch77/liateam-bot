import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import type { OrderStatus } from '@/lib/orders/status';

/**
 * Shop orders (migration 013). Money is TOMAN; there is no purchase price anywhere in these tables. The status moves
 * only along order_status_can_move (a trigger refuses anything else) and the amounts and the address never change.
 */
export type OrderRow = {
  id: string;
  number: string;
  user_id: string;
  status: OrderStatus;
  payment_method: 'gateway' | 'wallet';
  recipient_name: string;
  recipient_phone: string;
  province: string;
  city: string;
  province_id: number;
  city_id: number;
  postal_code: string;
  line: string;
  plate: string;
  unit: string | null;
  items_total: number;
  discount_total: number;
  shipping_supplier_price: number;
  shipping_charged: number;
  shipping_absorbed: number;
  total_payable: number;
  refunded_total: number;
  review_id: number | null;
  live_checked_at: Date | null;
  live_ok: boolean | null;
  live_total: number | null;
  live_expires_at: Date | null;
  bot_order_id: number | null;
  needs_review_reason: string | null;
  referrer_user_id: string | null;
  paid_at: Date | null;
  placed_at: Date | null;
  supplier_paid_at: Date | null;
  sent_at: Date | null;
  canceled_at: Date | null;
  created_at: Date;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: number;
  name: string;
  quantity: number;
  unit_list_price: number;
  unit_price: number;
  discount_percent: number;
  discount_label: string | null;
  pricing_mode: 'partner' | 'consumer' | 'beyond_base' | null;
  line_total: number;
  bot_status: 'ok' | 'refunded';
  refunded_quantity: number;
  refunded_amount: number;
};

export type NewOrderItem = {
  productId: number;
  name: string;
  quantity: number;
  unitListPrice: number;
  unitPrice: number;
  discountPercent?: number;
  discountLabel?: string | null;
  pricingMode?: OrderItemRow['pricing_mode'];
};

export type NewOrder = {
  userId: string;
  idempotencyKey: string;
  paymentMethod: 'gateway' | 'wallet';
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  provinceId: number;
  cityId: number;
  postalCode: string;
  line: string;
  plate: string;
  unit?: string | null;
  itemsTotal: number;
  discountTotal: number;
  shippingSupplierPrice: number;
  shippingCharged: number;
  referrerUserId?: string | null;
  items: readonly NewOrderItem[];
};

export type OrderEventRow = {
  id: string;
  kind: string;
  actor_user_id: string | null;
  data: unknown;
  created_at: Date;
};

// BIGINT money as float8: exact below 2^53 (far above any order), and pg then returns a number.
const COLS = `id::text, number, user_id::text, status, payment_method, recipient_name, recipient_phone, province, city,
  province_id, city_id, postal_code, line, plate, unit,
  items_total::float8, discount_total::float8, shipping_supplier_price::float8, shipping_charged::float8,
  shipping_absorbed::float8, total_payable::float8, refunded_total::float8,
  review_id, live_checked_at, live_ok, live_total::float8, live_expires_at, bot_order_id, needs_review_reason,
  referrer_user_id::text, paid_at, placed_at, supplier_paid_at, sent_at, canceled_at, created_at`;
const ITEM_COLS = `id::text, order_id::text, product_id, name, quantity, unit_list_price::float8, unit_price::float8,
  discount_percent::float8, discount_label, pricing_mode, line_total::float8, bot_status, refunded_quantity,
  refunded_amount::float8`;

export const orderRepository = {
  /**
   * Creates an order with its lines. The idempotency key makes a repeated request (a double click, a retry) return the
   * order already made: `created` is false then and nothing is inserted twice. Run inside a transaction.
   */
  async create(o: NewOrder, db?: Queryable): Promise<{ order: OrderRow; created: boolean }> {
    const rows = await query<{ id: string }>(
      'order.create',
      `INSERT INTO orders (user_id, idempotency_key, payment_method, recipient_name, recipient_phone, province, city,
                           province_id, city_id, postal_code, line, plate, unit, items_total, discount_total,
                           shipping_supplier_price, shipping_charged, referrer_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text`,
      [
        o.userId,
        o.idempotencyKey,
        o.paymentMethod,
        o.recipientName,
        o.recipientPhone,
        o.province,
        o.city,
        o.provinceId,
        o.cityId,
        o.postalCode,
        o.line,
        o.plate,
        o.unit ?? null,
        o.itemsTotal,
        o.discountTotal,
        o.shippingSupplierPrice,
        o.shippingCharged,
        o.referrerUserId ?? null,
      ],
      db,
    );
    if (!rows[0]) {
      const existing = await this.findByIdempotencyKey(o.idempotencyKey, db);
      if (!existing) throw new Error('order idempotency conflict without an order');
      return { order: existing, created: false };
    }
    const id = rows[0].id;
    for (const it of o.items) {
      await query(
        'order.create_item',
        `INSERT INTO order_items (order_id, product_id, name, quantity, unit_list_price, unit_price, discount_percent,
                                  discount_label, pricing_mode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          it.productId,
          it.name,
          it.quantity,
          it.unitListPrice,
          it.unitPrice,
          it.discountPercent ?? 0,
          it.discountLabel ?? null,
          it.pricingMode ?? null,
        ],
        db,
      );
    }
    const order = await this.findById(id, db);
    return { order: order!, created: true };
  },

  async findById(id: string, db?: Queryable): Promise<OrderRow | null> {
    return queryOne<OrderRow>('order.find', `SELECT ${COLS} FROM orders WHERE id = $1`, [id], db);
  },

  async findByNumber(number: string, db?: Queryable): Promise<OrderRow | null> {
    return queryOne<OrderRow>(
      'order.find_number',
      `SELECT ${COLS} FROM orders WHERE number = $1`,
      [number],
      db,
    );
  },

  async findByIdempotencyKey(key: string, db?: Queryable): Promise<OrderRow | null> {
    return queryOne<OrderRow>(
      'order.find_key',
      `SELECT ${COLS} FROM orders WHERE idempotency_key = $1`,
      [key],
      db,
    );
  },

  async listForUser(userId: string, limit = 20, db?: Queryable): Promise<OrderRow[]> {
    return query<OrderRow>(
      'order.list_user',
      `SELECT ${COLS} FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
      db,
    );
  },

  async items(orderId: string, db?: Queryable): Promise<OrderItemRow[]> {
    return query<OrderItemRow>(
      'order.items',
      `SELECT ${ITEM_COLS} FROM order_items WHERE order_id = $1 ORDER BY id`,
      [orderId],
      db,
    );
  },

  /** The result of the live check against Liateam (the bot's «review») made at checkout. */
  async recordLiveCheck(
    id: string,
    c: { reviewId: number; ok: boolean; liveTotal: number | null; expiresAt: Date | null },
    db?: Queryable,
  ): Promise<void> {
    await query(
      'order.live_check',
      `UPDATE orders SET review_id = $2, live_checked_at = now(), live_ok = $3, live_total = $4, live_expires_at = $5 WHERE id = $1`,
      [id, c.reviewId, c.ok, c.liveTotal, c.expiresAt],
      db,
    );
  },

  /**
   * Moves the status from `from` to `to` (false when the order is no longer in `from`: someone else moved it first).
   * The database refuses a move the status machine does not allow. `patch` sets the matching timestamp / note.
   */
  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    patch: {
      paidAt?: boolean;
      placedAt?: boolean;
      supplierPaidAt?: boolean;
      sentAt?: boolean;
      canceledAt?: boolean;
      needsReviewReason?: string | null;
    } = {},
    db?: Queryable,
  ): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'order.transition',
      `UPDATE orders SET status = $3,
              paid_at = CASE WHEN $4 THEN coalesce(paid_at, now()) ELSE paid_at END,
              placed_at = CASE WHEN $5 THEN coalesce(placed_at, now()) ELSE placed_at END,
              supplier_paid_at = CASE WHEN $6 THEN coalesce(supplier_paid_at, now()) ELSE supplier_paid_at END,
              sent_at = CASE WHEN $7 THEN coalesce(sent_at, now()) ELSE sent_at END,
              canceled_at = CASE WHEN $8 THEN coalesce(canceled_at, now()) ELSE canceled_at END,
              needs_review_reason = CASE WHEN $3 = 'needs_review' THEN $9 ELSE NULL END
        WHERE id = $1 AND status = $2 RETURNING id::text`,
      [
        id,
        from,
        to,
        patch.paidAt ?? false,
        patch.placedAt ?? false,
        patch.supplierPaidAt ?? false,
        patch.sentAt ?? false,
        patch.canceledAt ?? false,
        (patch.needsReviewReason ?? null)?.slice(0, 300) ?? null,
      ],
      db,
    );
    return rows.length === 1;
  },

  /** Links the shop order to the bot's order (once; the number cannot be changed afterwards). */
  async linkBotOrder(id: string, botOrderId: number, db?: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'order.link_bot',
      'UPDATE orders SET bot_order_id = $2 WHERE id = $1 AND bot_order_id IS NULL RETURNING id::text',
      [id, botOrderId],
      db,
    );
    return rows.length === 1;
  },

  async setTracking(id: string, tracking: unknown, db?: Queryable): Promise<void> {
    await query(
      'order.tracking',
      'UPDATE orders SET tracking = $2::jsonb WHERE id = $1',
      [id, JSON.stringify(tracking)],
      db,
    );
  },

  /** Mirrors the bot's status of one line (ok | refunded). */
  async setItemBotStatus(
    orderId: string,
    productId: number,
    status: 'ok' | 'refunded',
    db?: Queryable,
  ): Promise<void> {
    await query(
      'order.item_bot_status',
      'UPDATE order_items SET bot_status = $3 WHERE order_id = $1 AND product_id = $2 AND bot_status <> $3',
      [orderId, productId, status],
      db,
    );
  },

  /** What the shop refunded for a line, from its own snapshot (never the bot's prices). Returns the amount added. */
  async refundItem(orderId: string, productId: number, quantity: number, db?: Queryable): Promise<number> {
    const rows = await query<{ added: number }>(
      'order.refund_item',
      `UPDATE order_items SET refunded_quantity = refunded_quantity + $3, refunded_amount = refunded_amount + unit_price * $3
        WHERE order_id = $1 AND product_id = $2 AND refunded_quantity + $3 <= quantity
        RETURNING (unit_price * $3)::float8 AS added`,
      [orderId, productId, quantity],
      db,
    );
    const added = rows[0]?.added ?? 0;
    if (added > 0) {
      await query(
        'order.refund_total',
        'UPDATE orders SET refunded_total = refunded_total + $2 WHERE id = $1',
        [orderId, added],
        db,
      );
    }
    return added;
  },

  async appendEvent(
    orderId: string,
    kind: string,
    actorUserId: string | null,
    data: unknown = null,
    db?: Queryable,
  ): Promise<void> {
    await query(
      'order.event',
      'INSERT INTO order_events (order_id, kind, actor_user_id, data) VALUES ($1, $2, $3, $4::jsonb)',
      [orderId, kind, actorUserId, data === null ? null : JSON.stringify(data)],
      db,
    );
  },

  async events(orderId: string, db?: Queryable): Promise<OrderEventRow[]> {
    return query<OrderEventRow>(
      'order.events',
      'SELECT id::text, kind, actor_user_id::text, data, created_at FROM order_events WHERE order_id = $1 ORDER BY id',
      [orderId],
      db,
    );
  },
};
