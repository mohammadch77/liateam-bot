import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import type { ReviewResult } from '@/lib/orders/review';
import type { OrderStatus } from '@/lib/orders/status';

/**
 * The shop's side of the sync bot's order queue (deploy/shop-db-roles-016-orders.sql). The shop role has no access to
 * the bot's tables: it puts jobs in the queue through five SECURITY DEFINER functions, reads their answers (the bot
 * strips every purchase price from a review) and reads a few COLUMNS of the bot's orders. Cost, profit and the bot's event
 * texts are not readable here by design.
 */
export type JobResult = { done: boolean; ok: boolean; result: unknown };

export type { ReviewResult };

/** The bot's order as the shop may see it. */
export type BotOrderRow = {
  id: number;
  status: OrderStatus;
  urgent: boolean;
  items_total: number;
  shipping_price: number;
  refunded_total: number;
  liateam_order_code: string | null;
  payment_url: string | null;
  placed_at: Date | null;
  supplier_paid_at: Date | null;
  sent_at: Date | null;
  tracking: unknown;
};

export type BotOrderItemRow = {
  order_id: number;
  product_id: number;
  quantity: number;
  status: 'ok' | 'refunded';
};

export const botOrderRepository = {
  /** Puts a live check of a basket in the queue; returns the job id to poll with reviewResult. */
  async enqueueReview(
    cityId: number,
    items: ReadonlyArray<{ productId: number; quantity: number }>,
    replacesReviewId: number | null = null,
    db?: Queryable,
  ): Promise<number> {
    const payload = items.map((i) => ({ product_id: i.productId, quantity: i.quantity }));
    const row = await queryOne<{ id: number }>(
      'bot.enqueue_review',
      'SELECT public.shop_enqueue_review($1::int, $2::jsonb, $3::int) AS id',
      [cityId, JSON.stringify(payload), replacesReviewId],
      db,
    );
    return row!.id;
  },

  async reviewResult(
    jobId: number,
    db?: Queryable,
  ): Promise<{ done: boolean; ok: boolean; result: ReviewResult | { error: string } | null } | null> {
    return queryOne(
      'bot.review_result',
      'SELECT done, ok, result FROM public.shop_review_result($1::int)',
      [jobId],
      db,
    );
  },

  /** The customer paid: asks the bot to turn the (fresh, single-use) review into its queued order. Asking twice returns the same job. */
  async enqueueCreate(
    reviewId: number,
    customer: { firstName: string; lastName: string; mobile: string },
    address: {
      provinceId: number;
      cityId: number;
      postalCode: string;
      address: string;
      plate: string;
      unit?: string | null;
    },
    db?: Queryable,
  ): Promise<number> {
    const row = await queryOne<{ id: number }>(
      'bot.enqueue_create',
      'SELECT public.shop_enqueue_create($1::int, $2::jsonb, $3::jsonb) AS id',
      [
        reviewId,
        JSON.stringify({
          first_name: customer.firstName,
          last_name: customer.lastName,
          mobile: customer.mobile,
        }),
        JSON.stringify({
          province_id: address.provinceId,
          city_id: address.cityId,
          postal_code: address.postalCode,
          address: address.address,
          plate: address.plate,
          unit: address.unit ?? '',
        }),
      ],
      db,
    );
    return row!.id;
  },

  /** done / ok / result = {order_id, status, total} (the bot's order id) or {error}. */
  async createResult(jobId: number, db?: Queryable): Promise<JobResult | null> {
    return queryOne<JobResult>(
      'bot.create_result',
      'SELECT done, ok, result FROM public.shop_create_result($1::int)',
      [jobId],
      db,
    );
  },

  /**
   * Place the order at Liateam now. `expectedTotal` = the Liateam-priced goods + shipping the customer was shown; the
   * bot stops the order in needs_review when the live total moved by more than `maxDiff` (null = the bot's own) or an item is short.
   * Returns the job id, or null when a place job for this order is already waiting.
   */
  async enqueuePlace(
    botOrderId: number,
    expectedTotal: number,
    maxDiff: number | null = null,
    db?: Queryable,
  ): Promise<number | null> {
    const row = await queryOne<{ id: number | null }>(
      'bot.enqueue_place',
      'SELECT public.shop_enqueue_place($1::int, $2::bigint, $3::int) AS id',
      [botOrderId, expectedTotal, maxDiff],
      db,
    );
    return row?.id ?? null;
  },

  async orders(botOrderIds: readonly number[], db?: Queryable): Promise<BotOrderRow[]> {
    if (!botOrderIds.length) return [];
    return query<BotOrderRow>(
      'bot.orders',
      `SELECT id, status, urgent, items_total::float8, shipping_price::float8, refunded_total::float8, liateam_order_code,
              payment_url, placed_at, supplier_paid_at, sent_at, tracking
         FROM public.shop_orders WHERE id = ANY($1::int[])`,
      [botOrderIds],
      db,
    );
  },

  /** status of each line: ok | refunded. (No price, no cost: the shop reads only these columns.) */
  async orderItems(botOrderIds: readonly number[], db?: Queryable): Promise<BotOrderItemRow[]> {
    if (!botOrderIds.length) return [];
    return query<BotOrderItemRow>(
      'bot.order_items',
      'SELECT order_id, product_id, quantity, status FROM public.shop_order_items WHERE order_id = ANY($1::int[])',
      [botOrderIds],
      db,
    );
  },
};
