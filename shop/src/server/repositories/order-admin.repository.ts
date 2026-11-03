import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import { ADMIN_SORTS, type AdminSort } from '@/lib/orders/operator';
import type { OrderStatus } from '@/lib/orders/status';

/**
 * What the operator's order pages read (task J). Everything here is the shop's own data: no purchase price, no profit, nothing
 * from the bot's tables (those come through bot-order.repository). The caller decides who may see the whole phone number.
 */
export type AdminOrderFilter = {
  statuses: readonly OrderStatus[] | null;
  /** only the orders an operator has to act on */
  action: boolean;
  number: string | null;
  phone: string | null;
  /** a search that is not a number or a phone: finds nothing */
  nothing: boolean;
  /** Tehran calendar days YYYY-MM-DD, inclusive */
  from: string | null;
  to: string | null;
  sort: AdminSort;
};

export type AdminOrderRow = {
  id: string;
  number: string;
  status: OrderStatus;
  created_at: Date;
  total_payable: number;
  customer_name: string | null;
  customer_phone: string;
  needs_action: boolean;
  cancel_requested: boolean;
};

/**
 * Orders an operator has to look at, as one SQL condition on `o`: stopped for review, paid and waiting for the operator to place
 * (a stuck alert or a «waiting_for_placement» event), placed at Liateam and waiting for its payment, or carrying a customer's
 * cancel request nobody answered yet.
 */
const OPEN_REQUEST = `(EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind = 'cancel_requested')
   AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind IN ('cancel_request_rejected', 'cancel_request_approved')))`;
const NEEDS_ACTION = `(o.status IN ('needs_review', 'awaiting_payment')
   OR (o.status = 'queued' AND EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.kind IN ('stuck_alert', 'waiting_for_placement')))
   OR (o.status IN ('placing', 'awaiting_payment') AND ${OPEN_REQUEST}))`;

const WHERE = `($1::text[] IS NULL OR o.status::text = ANY($1::text[]))
   AND (NOT $2::boolean OR ${NEEDS_ACTION})
   AND ($3::text IS NULL OR o.number = $3::text)
   AND ($4::text IS NULL OR u.phone = $4::text OR o.recipient_phone = $4::text)
   AND NOT $5::boolean
   AND ($6::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Tehran')::date >= $6::date)
   AND ($7::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Tehran')::date <= $7::date)`;

const args = (f: AdminOrderFilter) => [f.statuses, f.action, f.number, f.phone, f.nothing, f.from, f.to];

export type AdminOrderDetailExtras = {
  customer: { id: string; phone: string; full_name: string | null } | null;
  payments: Array<{
    id: string;
    method: string;
    gateway: string | null;
    gateway_ref: string | null;
    amount: number;
    status: string;
    created_at: Date;
    confirmed_at: Date | null;
  }>;
  commissions: Array<{
    id: string;
    level: number;
    status: string;
    amount: number;
    affiliate_phone: string;
    manual_approval: boolean;
  }>;
  notes: Array<{ id: string; body: string; created_at: Date; author_id: string | null; author_name: string | null }>;
  events: Array<{
    id: string;
    kind: string;
    data: unknown;
    created_at: Date;
    actor_user_id: string | null;
    actor_name: string | null;
  }>;
};

export const orderAdminRepository = {
  async page(f: AdminOrderFilter, limit: number, offset: number, db?: Queryable) {
    const rows = await query<AdminOrderRow>(
      'order_admin.page',
      `SELECT o.id::text, o.number, o.status, o.created_at, o.total_payable::float8, u.full_name AS customer_name,
              u.phone AS customer_phone, ${NEEDS_ACTION} AS needs_action, ${OPEN_REQUEST} AS cancel_requested
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ${WHERE}
        ORDER BY ${ADMIN_SORTS[f.sort].sql} LIMIT $8 OFFSET $9`,
      [...args(f), limit, offset],
      db,
    );
    const n = await queryOne<{ n: number }>(
      'order_admin.count',
      `SELECT count(*)::int AS n FROM orders o JOIN users u ON u.id = o.user_id WHERE ${WHERE}`,
      args(f),
      db,
    );
    return { rows, total: n?.n ?? 0 };
  },

  /** how many orders need an operator now (for «نیازمند توجه» and the list's chip) */
  async actionCount(db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'order_admin.action_count',
      `SELECT count(*)::int AS n FROM orders o WHERE ${NEEDS_ACTION}`,
      [],
      db,
    );
    return r?.n ?? 0;
  },

  async detailExtras(orderId: string, userId: string, db?: Queryable): Promise<AdminOrderDetailExtras> {
    const [customer, payments, commissions, notes, events] = await Promise.all([
      queryOne<{ id: string; phone: string; full_name: string | null }>(
        'order_admin.customer',
        'SELECT id::text, phone, full_name FROM users WHERE id = $1',
        [userId],
        db,
      ),
      query<AdminOrderDetailExtras['payments'][number]>(
        'order_admin.payments',
        `SELECT id::text, method, gateway, gateway_ref, amount::float8, status::text, created_at, confirmed_at
           FROM payments WHERE order_id = $1 ORDER BY id`,
        [orderId],
        db,
      ),
      query<AdminOrderDetailExtras['commissions'][number]>(
        'order_admin.commissions',
        `SELECT c.id::text, c.level, c.status::text, c.amount::float8, u.phone AS affiliate_phone, c.manual_approval
           FROM commissions c JOIN users u ON u.id = c.affiliate_user_id WHERE c.order_id = $1 ORDER BY c.level, c.id`,
        [orderId],
        db,
      ),
      query<AdminOrderDetailExtras['notes'][number]>(
        'order_admin.notes',
        `SELECT n.id::text, n.body, n.created_at, n.author_id::text, a.full_name AS author_name
           FROM order_notes n LEFT JOIN users a ON a.id = n.author_id WHERE n.order_id = $1 ORDER BY n.id`,
        [orderId],
        db,
      ),
      query<AdminOrderDetailExtras['events'][number]>(
        'order_admin.events',
        `SELECT e.id::text, e.kind, e.data, e.created_at, e.actor_user_id::text, a.full_name AS actor_name
           FROM order_events e LEFT JOIN users a ON a.id = e.actor_user_id WHERE e.order_id = $1 ORDER BY e.id`,
        [orderId],
        db,
      ),
    ]);
    return { customer, payments, commissions, notes, events };
  },

  async addNote(orderId: string, authorId: string, body: string, db?: Queryable): Promise<void> {
    await query(
      'order_admin.add_note',
      'INSERT INTO order_notes (order_id, author_id, body) VALUES ($1, $2, $3)',
      [orderId, authorId, body],
      db,
    );
  },

  /** paid orders whose Liateam payment link is in its last minutes or past its end, with no warning event for THIS link yet */
  async linkWatch(db?: Queryable): Promise<Array<{ id: string; number: string; bot_order_id: number }>> {
    return query<{ id: string; number: string; bot_order_id: number }>(
      'order_admin.link_watch',
      `SELECT o.id::text, o.number, o.bot_order_id FROM orders o
        WHERE o.status = 'awaiting_payment' AND o.bot_order_id IS NOT NULL ORDER BY o.id LIMIT 200`,
      [],
      db,
    );
  },
};
