import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { ORDER_STATUS_LABEL } from '@/lib/orders/filters';
import { OPERATOR_EVENT_LABEL } from '@/lib/orders/operator';
import { trackingCode } from '@/lib/orders/payment-flow';
import { requireRole } from '@/server/auth/guards';
import { orderAdminService, type AdminDetailView } from '@/server/services/order-admin.service';
import { Alert, Badge, Breadcrumb } from '@/ui';
import s from '../../../account/account.module.css';
import a from '../../affiliates/admin-affiliates.module.css';
import { LinkCountdown } from './LinkCountdown';
import { OperatorPanel } from './OperatorPanel';

export const metadata: Metadata = { title: 'جزئیات سفارش', robots: { index: false, follow: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });
const COMMISSION_STATUS: Record<string, string> = {
  pending: 'در انتظار',
  approved: 'تأیید شد',
  paid: 'واریز شد',
  cancelled: 'لغو شد',
};
const PAYMENT_STATUS: Record<string, string> = {
  initiated: 'آغاز شد',
  confirmed: 'تأیید شد',
  failed: 'ناموفق',
  canceled: 'انصراف',
};
const REVIEW_TEXT: Record<string, string> = {
  price_up: 'قیمت لیاتیم بالاتر از مبلغ نشان‌داده‌شده به مشتری است؛ ادامه ممکن نیست (مشتری برای پرداخت بیشتر موافقت نکرده): لغو کنید یا بررسی دوباره بخواهید.',
  price_down: 'قیمت لیاتیم ارزان‌تر شده؛ می‌توانید ادامه دهید و تفاوت به کیف پول مشتری برمی‌گردد.',
  price_same: 'جمع لیاتیم با مبلغ نشان‌داده‌شده یکی است؛ می‌توانید با همان ادامه دهید.',
  unavailable: 'کالایی ناموجود یا کمتر از تعداد سفارش است؛ ادامه ممکن نیست: لغو کنید یا بررسی دوباره بخواهید.',
  unknown: 'جزئیات تفاوت از ربات در دسترس نیست؛ لغو کنید یا بررسی دوباره بخواهید.',
};

/** the data an operator may read next to an event: a reason, a reference, an amount returned (never raw JSON) */
function eventFacts(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const out: string[] = [];
  if (typeof d.reason === 'string' && d.reason) out.push(`دلیل: ${d.reason}`);
  if (typeof d.ref === 'string' && d.ref) out.push(`مرجع: ${d.ref}`);
  if (typeof d.refunded === 'number' && d.refunded > 0) out.push(`بازگشت به کیف پول: ${formatToman(d.refunded)} تومان`);
  return out;
}

export default async function AdminOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  await requireRole('support', `/admin/orders/${number}`);
  let v: AdminDetailView;
  try {
    v = await orderAdminService.detail(number);
  } catch (e) {
    if (e instanceof AppError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const { order, bot } = v;
  const reviewNote =
    v.review && v.review.live_total !== null && v.review.expected_total !== null
      ? `جمع فعلی لیاتیم ${formatToman(v.review.live_total)} تومان، جمع نشان‌داده‌شده به مشتری ${formatToman(v.review.expected_total)} تومان.`
      : null;

  return (
    <div className={s.page}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'مدیریت', href: '/admin' },
          { label: 'سفارش‌ها', href: '/admin/orders' },
          { label: order.number },
        ]}
      />
      <section className={s.card} aria-labelledby="ord-title" style={{ maxWidth: 'none' }} data-order-detail={order.number}>
        <h1 id="ord-title" className={s.title}>
          سفارش <span className="tnum">{order.number}</span>{' '}
          <Badge tone={order.status === 'canceled' || order.status === 'refunded' ? 'outOfStock' : 'neutral'}>
            <span data-order-status={order.status}>{ORDER_STATUS_LABEL[order.status]}</span>
          </Badge>
        </h1>
        <p className={a.muted}>ثبت: {timeFa.format(order.created_at)}</p>
        {v.openCancelRequest && (
          <Alert tone="warning">
            <span data-cancel-request>مشتری درخواست لغو داده و منتظر پاسخ شماست.</span>
          </Alert>
        )}
        {!v.isAdmin && <Alert tone="warning">فقط مشاهده: اقدام‌ها مخصوص ادمین است.</Alert>}
        {v.isAdmin && <OperatorPanel number={order.number} actions={v.actions} reviewNote={reviewNote} />}
      </section>

      {order.status === 'needs_review' && (
        <section className={s.card} style={{ maxWidth: 'none' }} data-review-section>
          <h2 className={s.h2}>دلیل توقف برای بررسی</h2>
          {v.review ? (
            <>
              <p data-review-why>{v.review.why ?? order.needs_review_reason ?? '—'}</p>
              {reviewNote && <p className="tnum">{reviewNote}</p>}
              <p data-review-kind={v.review.kind}>{REVIEW_TEXT[v.review.kind]}</p>
              {v.review.missing && v.review.missing.length > 0 && (
                <p className={a.muted}>کد کالاهای مشکل‌دار: {v.review.missing.map((m) => toFaDigits(m)).join('، ')}</p>
              )}
            </>
          ) : (
            <p>{order.needs_review_reason ?? 'ساخت سفارش در ربات انجام نشد؛ فقط لغو ممکن است.'}</p>
          )}
        </section>
      )}

      {order.status === 'awaiting_payment' && (
        <section className={s.card} style={{ maxWidth: 'none' }} data-link-section>
          <h2 className={s.h2}>پرداخت نهایی در لیاتیم</h2>
          {bot?.payment_url && v.isAdmin ? (
            <p>
              <a href={bot.payment_url} target="_blank" rel="noopener noreferrer" dir="ltr" data-payment-url>
                لینک پرداخت لیاتیم
              </a>
            </p>
          ) : (
            <p data-no-link>لینک پرداخت از ربات در دسترس نیست.</p>
          )}
          {v.link.expiresAt ? (
            <p>
              زمان باقی‌مانده تا پایان مهلت {toFaDigits(v.linkTtlMinutes)} دقیقه‌ای:{' '}
              <LinkCountdown expiresAt={v.link.expiresAt.toISOString()} remindMinutes={v.linkRemindMinutes} />
              {v.link.state === 'expired' && (
                <span data-link-expired>
                  {' '}
                  — لینک منقضی شده؛ ربات سفارش را به صف برمی‌گرداند و سپس «ثبت در لیاتیم» لینک تازه می‌سازد.
                </span>
              )}
            </p>
          ) : (
            <p className={a.muted}>زمان صدور لینک ثبت نشده است.</p>
          )}
        </section>
      )}

      <section className={s.card} style={{ maxWidth: 'none' }} aria-label="اقلام">
        <h2 className={s.h2}>اقلام و مبلغ</h2>
        <ul className={s.rows}>
          {v.items.map((it) => (
            <li key={it.id} className={s.row} data-item>
              <div className={s.rowMain}>
                <b>{it.name}</b>
                <span className={s.muted}>
                  {toFaDigits(it.quantity)} × {formatToman(it.unit_price)} تومان
                  {it.bot_status === 'refunded' && ' · بازگشت داده شد'}
                </span>
              </div>
              <b className="tnum">{formatToman(it.line_total)}</b>
            </li>
          ))}
        </ul>
        <dl className={s.list}>
          <div>
            <dt>جمع کالاها</dt>
            <dd className="tnum">{formatToman(order.items_total)} تومان</dd>
          </div>
          {order.discount_total > 0 && (
            <div>
              <dt>تخفیف</dt>
              <dd className="tnum">{formatToman(order.discount_total)} تومان</dd>
            </div>
          )}
          <div>
            <dt>ارسال</dt>
            <dd className="tnum">{formatToman(order.shipping_charged)} تومان</dd>
          </div>
          <div>
            <dt>پرداختی مشتری</dt>
            <dd className="tnum" data-total>
              {formatToman(order.total_payable)} تومان
            </dd>
          </div>
        </dl>
      </section>

      <section className={s.card} style={{ maxWidth: 'none' }} aria-label="مشتری و تحویل">
        <h2 className={s.h2}>مشتری و آدرس تحویل</h2>
        <dl className={s.list}>
          <div>
            <dt>مشتری</dt>
            <dd>{v.extras.customer?.full_name ?? order.recipient_name}</dd>
          </div>
          <div>
            <dt>موبایل</dt>
            <dd dir="ltr" data-phone>
              {toFaDigits(v.phone)}
            </dd>
          </div>
          <div>
            <dt>گیرنده</dt>
            <dd>{order.recipient_name}</dd>
          </div>
          <div>
            <dt>آدرس</dt>
            <dd data-address>
              {v.isAdmin
                ? `${order.province}، ${order.city}، ${order.line}، پلاک ${order.plate}${order.unit ? `، واحد ${order.unit}` : ''} · کدپستی ${order.postal_code}`
                : `${order.province}، ${order.city}`}
            </dd>
          </div>
        </dl>
      </section>

      <section className={s.card} style={{ maxWidth: 'none' }} aria-label="پرداخت">
        <h2 className={s.h2}>پرداخت مشتری</h2>
        <p>روش: {order.payment_method === 'wallet' ? 'کیف پول' : 'درگاه پرداخت'}</p>
        {v.extras.payments.length === 0 ? (
          <p className={a.muted}>پرداختی ثبت نشده.</p>
        ) : (
          <ul className={s.rows}>
            {v.extras.payments.map((p) => (
              <li key={p.id} className={s.row} data-payment={p.status}>
                <div className={s.rowMain}>
                  <b className="tnum">{formatToman(p.amount)} تومان</b>
                  <span className={s.muted}>
                    {PAYMENT_STATUS[p.status] ?? p.status} · {p.gateway ?? 'کیف پول'}
                    {p.gateway_ref && v.isAdmin && (
                      <>
                        {' '}
                        · شناسه: <span dir="ltr">{p.gateway_ref}</span>
                      </>
                    )}
                  </span>
                </div>
                <span className={s.muted}>{timeFa.format(p.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.card} style={{ maxWidth: 'none' }} aria-label="سفارش در ربات">
        <h2 className={s.h2}>سفارش ربات و لیاتیم</h2>
        {bot ? (
          <dl className={s.list}>
            <div>
              <dt>سفارش ربات</dt>
              <dd className="tnum" data-bot-order>
                #{toFaDigits(bot.id)} · {bot.status}
              </dd>
            </div>
            {bot.liateam_order_code && (
              <div>
                <dt>کد سفارش لیاتیم</dt>
                <dd dir="ltr">{bot.liateam_order_code}</dd>
              </div>
            )}
            {bot.placed_at && (
              <div>
                <dt>ثبت در لیاتیم</dt>
                <dd>{timeFa.format(bot.placed_at)}</dd>
              </div>
            )}
            {order.tracking != null && trackingCode(order.tracking) && (
              <div>
                <dt>کد رهگیری</dt>
                <dd dir="ltr" data-tracking>
                  {trackingCode(order.tracking)}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className={a.muted}>هنوز سفارش متناظری در ربات ساخته نشده است.</p>
        )}
      </section>

      <section className={s.card} style={{ maxWidth: 'none' }} aria-label="پورسانت">
        <h2 className={s.h2}>پورسانت‌های این سفارش</h2>
        {v.extras.commissions.length === 0 ? (
          <p className={a.muted}>پورسانتی ثبت نشده.</p>
        ) : (
          <ul className={s.rows}>
            {v.extras.commissions.map((c) => (
              <li key={c.id} className={s.row} data-commission={c.status}>
                <div className={s.rowMain}>
                  <b className="tnum">{formatToman(c.amount)} تومان</b>
                  <span className={s.muted}>
                    سطح {toFaDigits(c.level)} · <span dir="ltr">{toFaDigits(v.isAdmin ? c.affiliate_phone : `${c.affiliate_phone.slice(0, 4)}•••${c.affiliate_phone.slice(-4)}`)}</span>
                    {c.manual_approval && ' · تأیید دستی'}
                  </span>
                </div>
                <Badge tone={c.status === 'cancelled' ? 'outOfStock' : 'neutral'}>{COMMISSION_STATUS[c.status] ?? c.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {v.isAdmin && (
        <section className={s.card} style={{ maxWidth: 'none' }} aria-label="یادداشت‌ها" data-notes>
          <h2 className={s.h2}>یادداشت‌های داخلی (برای مشتری نمایش داده نمی‌شود)</h2>
          {v.notes.length === 0 ? (
            <p className={a.muted}>یادداشتی نیست.</p>
          ) : (
            <ul className={s.rows}>
              {v.notes.map((n) => (
                <li key={n.id} className={s.row} data-note>
                  <div className={s.rowMain}>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{n.body}</span>
                    <span className={s.muted}>
                      {n.author_name ?? `ادمین #${toFaDigits(n.author_id ?? '—')}`} · {timeFa.format(n.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className={s.card} style={{ maxWidth: 'none' }} aria-label="خط زمانی" data-operator-timeline>
        <h2 className={s.h2}>خط زمانی کامل</h2>
        <ol className={s.timeline}>
          {v.extras.events
            .filter((e) => (v.isAdmin ? true : e.kind !== 'admin_note'))
            .map((e) => {
              const to = e.kind === 'status' ? (e.data as { to?: string } | null)?.to : null;
              const facts = eventFacts(e.data);
              return (
                <li key={e.id} className={s.step} data-event={e.kind}>
                  <b>
                    {OPERATOR_EVENT_LABEL[e.kind] ?? e.kind}
                    {to && ` ← ${ORDER_STATUS_LABEL[to as keyof typeof ORDER_STATUS_LABEL] ?? to}`}
                  </b>
                  <span className={s.muted}>
                    {timeFa.format(e.created_at)}
                    {e.actor_user_id && ` · توسط ${e.actor_name ?? `کاربر #${toFaDigits(e.actor_user_id)}`}`}
                    {facts.length > 0 && v.isAdmin && ` · ${facts.join(' · ')}`}
                  </span>
                </li>
              );
            })}
        </ol>
      </section>
    </div>
  );
}
