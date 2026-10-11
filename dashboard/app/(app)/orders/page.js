import { q } from '@/lib/db';
import { getStatus } from '@/lib/data';
import { num, toman, ago, dateTime } from '@/lib/format';
import DbError from '../../components/DbError';
import OrdersClient from './OrdersClient';

export const dynamic = 'force-dynamic';

const STATUS = {
  queued: ['b-warn', 'در صف ثبت'], placing: ['b-warn', 'در حال ثبت'], awaiting_payment: ['b-warn', 'منتظر پرداخت به لیاتیم'],
  supplier_paid: ['b-ok', 'پرداخت‌شده به لیاتیم'], sent: ['b-ok', 'ارسال شد'], refunded: ['b-bad', 'برگشت وجه'], canceled: ['b-bad', 'لغو شد'],
};

export default async function OrdersPage() {
  let orders, products, status, events;
  try {
    [orders, products, status, events] = await Promise.all([
      q(`SELECT o.*, (SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'status', i.status) ORDER BY i.id)
                        FROM shop_order_items i WHERE i.order_id = o.id) AS items
           FROM shop_orders o ORDER BY o.id DESC LIMIT 50`),
      q(`SELECT id, name, price, stock FROM supplier_products WHERE is_sellable AND missing_since IS NULL ORDER BY name`),
      getStatus(),
      q(`SELECT id, at, order_id, kind, message FROM shop_order_events ORDER BY id DESC LIMIT 30`),
    ]);
  } catch (e) {
    return <DbError error={e} />;
  }
  const svc = status.orders;
  const alive = svc?.heartbeat && Date.now() - new Date(svc.heartbeat).getTime() < 60_000;
  const dryRun = svc?.dry_run !== false;
  const queued = orders.filter((o) => o.status === 'queued').length;

  return (
    <>
      <div className="page-head">
        <div><h1>سفارش‌ها</h1><div className="sub">صف سفارش مشتری‌ها، ثبت در لیاتیم و API آزمایشی</div></div>
      </div>
      {!alive && <div className="banner bad">سرویس سفارش‌ها (liateam-orders) روشن نیست؛ مرور و ثبت سفارش کار نمی‌کند.</div>}
      {dryRun
        ? <div className="banner ok">🧪 حالت آزمایشی روشن است: همه‌ی مراحل اجرا می‌شود ولی سفارشی در لیاتیم ثبت نمی‌شود (کلیدش پایین همین صفحه است).</div>
        : <div className="banner bad">⚠️ حالت واقعی: «ثبت و پرداخت» سفارش واقعی در لیاتیم ثبت می‌کند.</div>}
      <div className="grid g3">
        <div className="card"><div className="stat-label">در صف ثبت</div><div className="stat-value">{num(queued)}</div></div>
        <div className="card"><div className="stat-label">منتظر پرداخت به لیاتیم</div><div className="stat-value">{num(orders.filter((o) => o.status === 'awaiting_payment').length)}</div></div>
        <div className="card"><div className="stat-label">سرویس سفارش‌ها</div><div className="stat-value">{alive ? 'روشن' : 'خاموش'}</div><div className="sub">{svc?.heartbeat ? ago(svc.heartbeat) : '—'}</div></div>
      </div>
      <OrdersClient
        products={products.map((p) => ({ id: p.id, name: p.name, price: Number(p.price), stock: p.stock }))}
        orders={orders.map((o) => ({
          id: o.id, status: o.status, statusLabel: STATUS[o.status]?.[1] ?? o.status, statusClass: STATUS[o.status]?.[0] ?? 'b-hidden',
          urgent: o.urgent, created: dateTime(o.created_at), customer: `${o.customer_first_name} ${o.customer_last_name}`,
          total: toman(Number(o.items_total) + Number(o.shipping_price)), refunded: Number(o.refunded_total) ? toman(o.refunded_total) : null,
          liateamCode: o.liateam_order_code, paymentUrl: o.status === 'awaiting_payment' ? o.payment_url : null,
          lastError: o.last_error, items: o.items ?? [], dryRunAt: o.dry_run_result?.at ? dateTime(o.dry_run_result.at) : null,
        }))}
        events={events.map((e) => ({ id: e.id, at: ago(e.at), orderId: e.order_id, kind: e.kind, message: e.message }))}
        dryRun={dryRun}
      />
    </>
  );
}
