import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import { AppError } from '@/lib/errors';

/**
 * The customer's payments to the shop (migration 013). An order is confirmed once: a unique index in the database
 * refuses a second confirmation, so a gateway callback that arrives twice cannot count the money twice.
 */
export type PaymentRow = {
  id: string;
  order_id: string;
  method: 'gateway' | 'wallet';
  gateway: string | null;
  amount: number;
  status: 'initiated' | 'confirmed' | 'failed';
  gateway_ref: string | null;
  created_at: Date;
  confirmed_at: Date | null;
};

const COLS =
  'id::text, order_id::text, method, gateway, amount::float8, status, gateway_ref, created_at, confirmed_at';

export const paymentRepository = {
  /** Starts a payment attempt; the same idempotency key returns the attempt already made. */
  async initiate(
    p: {
      orderId: string;
      method: 'gateway' | 'wallet';
      gateway?: string | null;
      amount: number;
      idempotencyKey: string;
    },
    db?: Queryable,
  ): Promise<PaymentRow> {
    const rows = await query<PaymentRow>(
      'payment.initiate',
      `INSERT INTO payments (order_id, method, gateway, amount, idempotency_key) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${COLS}`,
      [p.orderId, p.method, p.gateway ?? null, p.amount, p.idempotencyKey],
      db,
    );
    if (rows[0]) return rows[0];
    const existing = await queryOne<PaymentRow>(
      'payment.find_key',
      `SELECT ${COLS} FROM payments WHERE idempotency_key = $1`,
      [p.idempotencyKey],
      db,
    );
    if (!existing) throw new AppError('INTERNAL');
    return existing;
  },

  async findById(id: string, db?: Queryable): Promise<PaymentRow | null> {
    return queryOne<PaymentRow>('payment.find', `SELECT ${COLS} FROM payments WHERE id = $1`, [id], db);
  },

  async listForOrder(orderId: string, db?: Queryable): Promise<PaymentRow[]> {
    return query<PaymentRow>(
      'payment.list',
      `SELECT ${COLS} FROM payments WHERE order_id = $1 ORDER BY id`,
      [orderId],
      db,
    );
  },

  /**
   * Confirms a payment. False when it was already confirmed or failed, or when another payment of the same order or the
   * same gateway reference is already confirmed — the money is counted once. Run inside the transaction that also
   * moves the order to «queued».
   */
  async confirm(id: string, gatewayRef: string | null, db?: Queryable): Promise<boolean> {
    try {
      const rows = await query<{ id: string }>(
        'payment.confirm',
        `UPDATE payments SET status = 'confirmed', confirmed_at = now(), gateway_ref = coalesce($2, gateway_ref)
          WHERE id = $1 AND status = 'initiated' RETURNING id::text`,
        [id, gatewayRef],
        db,
      );
      return rows.length === 1;
    } catch (e) {
      if (e instanceof AppError && e.code === 'CONFLICT') return false;
      throw e;
    }
  },

  async fail(id: string, reason: string, db?: Queryable): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'payment.fail',
      `UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1 AND status = 'initiated' RETURNING id::text`,
      [id, reason.slice(0, 200)],
      db,
    );
    return rows.length === 1;
  },
};
