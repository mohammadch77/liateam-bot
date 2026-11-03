import 'server-only';
import { AppError } from '@/lib/errors';
import {
  ADMIN_STATUS_FILTERS,
  adminSortOf,
  adminStatusFilterOf,
  allowedActions,
  linkClock,
  parseDay,
  parseOrderSearch,
  type AdminSort,
  type AdminStatusFilter,
  type OperatorAction,
  type ReviewKind,
} from '@/lib/orders/operator';
import { maskMobile } from '@/lib/phone';
import { authorize } from '@/server/auth/guards';
import { botOrderRepository, type BotOrderRow, type ReviewInfo } from '@/server/repositories/bot-order.repository';
import {
  orderAdminRepository,
  type AdminOrderDetailExtras,
  type AdminOrderFilter,
  type AdminOrderRow,
} from '@/server/repositories/order-admin.repository';
import { orderRepository, type OrderItemRow, type OrderRow } from '@/server/repositories/order.repository';
import { operatorContext } from './order-operator.service';
import { settingsRead } from './settings-read.service';

/**
 * The operator's reads (task J). Viewing is for the support role and the admin; only the admin sees a whole phone number and the
 * whole address, and only the admin gets the action list (the actions check the admin role again themselves). No purchase price,
 * no profit: the lines are the shop's own snapshot, the bot's order is read through its allowed columns.
 */
const PAGE = 25;

export type AdminListQuery = {
  status?: unknown;
  q?: unknown;
  from?: unknown;
  to?: unknown;
  sort?: unknown;
  page?: unknown;
};

export type AdminListView = {
  rows: Array<AdminOrderRow & { phone_masked: string }>;
  total: number;
  page: number;
  pages: number;
  status: AdminStatusFilter;
  sort: AdminSort;
  q: string;
  from: string | null;
  to: string | null;
  actionCount: number;
};

export type AdminDetailView = {
  order: OrderRow;
  items: OrderItemRow[];
  extras: AdminOrderDetailExtras;
  isAdmin: boolean;
  /** the whole phone only for the admin */
  phone: string;
  phoneMasked: string;
  bot: BotOrderRow | null;
  review: (ReviewInfo & { kind: ReviewKind }) | null;
  actions: OperatorAction[];
  openCancelRequest: boolean;
  link: ReturnType<typeof linkClock>;
  linkTtlMinutes: number;
  linkRemindMinutes: number;
  /** operator-facing words for the events, with the actor's name */
  notes: AdminOrderDetailExtras['notes'];
};

async function viewer() {
  return authorize('support');
}

export const orderAdminService = {
  async list(raw: AdminListQuery): Promise<AdminListView> {
    await viewer();
    const status = adminStatusFilterOf(raw.status);
    const search = parseOrderSearch(raw.q);
    const sort = adminSortOf(raw.sort);
    const page = Math.min(Math.max(Math.floor(Number(raw.page)) || 1, 1), 10_000);
    const f: AdminOrderFilter = {
      statuses: ADMIN_STATUS_FILTERS[status].statuses as AdminOrderFilter['statuses'],
      action: status === 'action',
      number: search.number || null,
      phone: search.phone,
      nothing: search.number === '',
      from: parseDay(raw.from),
      to: parseDay(raw.to),
      sort,
    };
    const [{ rows, total }, actionCount] = await Promise.all([
      orderAdminRepository.page(f, PAGE, (page - 1) * PAGE),
      orderAdminRepository.actionCount(),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, phone_masked: maskMobile(r.customer_phone) })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE)),
      status,
      sort,
      q: typeof raw.q === 'string' ? raw.q.slice(0, 40) : '',
      from: f.from,
      to: f.to,
      actionCount,
    };
  },

  async detail(number: string): Promise<AdminDetailView> {
    const user = await viewer();
    if (!/^AV-\d{4,12}$/.test(number)) throw new AppError('NOT_FOUND');
    const order = await orderRepository.findByNumber(number);
    if (!order) throw new AppError('NOT_FOUND');
    const isAdmin = user.roles.includes('admin');
    const [items, extras, bots, { ctx, info }, ttl, remind] = await Promise.all([
      orderRepository.items(order.id),
      orderAdminRepository.detailExtras(order.id, order.user_id),
      order.bot_order_id !== null ? botOrderRepository.orders([order.bot_order_id]) : Promise.resolve([]),
      operatorContext(order),
      settingsRead.get('orders.payment_link_ttl_minutes'),
      settingsRead.get('orders.payment_link_remind_minutes'),
    ]);
    const bot = bots[0] ?? null;
    const phone = extras.customer?.phone ?? order.recipient_phone;
    return {
      order,
      items,
      extras,
      isAdmin,
      phone: isAdmin ? phone : maskMobile(phone),
      phoneMasked: maskMobile(phone),
      bot,
      review: info && ctx.reviewKind ? { ...info, kind: ctx.reviewKind } : null,
      actions: isAdmin ? allowedActions(ctx) : [],
      openCancelRequest: ctx.openCancelRequest,
      link: linkClock(bot?.placed_at ?? null, ttl, remind, new Date(), bot?.status === 'awaiting_payment'),
      linkTtlMinutes: ttl,
      linkRemindMinutes: remind,
      notes: extras.notes,
    };
  },
};
