import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { normalizeMobile } from '@/lib/phone';
import type { CommissionStatus } from '@/server/repositories/commission.repository';
import { requireRole } from '@/server/auth/guards';
import { commissionAdminService } from '@/server/services/commission-admin.service';
import { Alert, Breadcrumb, Button, Container, EmptyState, Pagination } from '@/ui';
import s from '../../account/account.module.css';
import a from '../affiliates/admin-affiliates.module.css';
import { decideCommissionAction } from './actions';

export const metadata: Metadata = { title: 'پورسانت‌ها', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });
const TABS: Array<{ key: string; status: CommissionStatus | null; label: string }> = [
  { key: 'pending', status: 'pending', label: 'در انتظار' },
  { key: 'paid', status: 'paid', label: 'واریزشده' },
  { key: 'cancelled', status: 'cancelled', label: 'لغوشده' },
  { key: 'all', status: null, label: 'همه' },
];

/** Every commission: filter by status and affiliate (number), the totals, «تأیید» (pays it into the wallet now) and «لغو» with a reason. */
export default async function AdminCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/commissions');
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.status) ?? TABS[0]!;
  const phone = typeof sp.phone === 'string' ? normalizeMobile(sp.phone) : null;
  const data = await commissionAdminService.list(tab.status, phone, Number(sp.page) || 1);
  const here = (p = 1) =>
    `/admin/commissions?status=${tab.key}${phone ? `&phone=${phone}` : ''}${p > 1 ? `&page=${p}` : ''}`;

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'پورسانت‌ها' }]} />
      <section className={s.card} aria-labelledby="com-title" style={{ maxWidth: 'none' }}>
        <h1 id="com-title" className={s.title}>
          پورسانت‌ها
        </h1>
        <nav aria-label="وضعیت" className={a.tabs}>
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/commissions?status=${t.key}`}
              className={a.tab}
              aria-current={t.key === tab.key ? 'page' : undefined}
            >
              {t.label} (
              {toFaDigits(
                t.status ? data.counts[t.status] : Object.values(data.counts).reduce((x, y) => x + y, 0),
              )}
              )
            </Link>
          ))}
        </nav>
        <form method="get" className={a.actions} aria-label="فیلتر همکار">
          <input type="hidden" name="status" value={tab.key} />
          <input name="phone" defaultValue={phone ?? ''} placeholder="شماره‌ی همکار (۰۹…)" aria-label="شماره‌ی همکار" className={a.reason} dir="ltr" />
          <Button type="submit" size="sm" variant="outline">
            فیلتر
          </Button>
        </form>
        <p className={s.muted} data-commission-sum>
          {toFaDigits(data.total)} مورد · جمع: <b className="tnum">{formatToman(data.sum)}</b> تومان
        </p>
        {sp.done === 'approved' && <Alert tone="success">تأیید شد و به کیف پول همکار واریز شد.</Alert>}
        {sp.done === 'cancelled' && <Alert tone="success">پورسانت لغو شد.</Alert>}
        {typeof sp.error === 'string' && <Alert tone="danger">{sp.error}</Alert>}
        {data.rows.length === 0 ? (
          <EmptyState icon="check_circle" title="پورسانتی در این بخش نیست." />
        ) : (
          <ul className={a.list}>
            {data.rows.map((c) => (
              <li key={c.id} className={a.item} data-commission-id={c.id} data-status={c.status}>
                <div className={a.head}>
                  <b className="tnum">{formatToman(c.amount)} تومان</b>
                  <span dir="ltr">{toFaDigits(c.affiliate_phone)}</span>
                  <span className={a.muted}>
                    سفارش {toFaDigits(c.order_number)} ({c.order_status}) · سطح {toFaDigits(c.level)} ·{' '}
                    {c.manual_approval ? 'تأیید دستی' : 'خودکار'}
                  </span>
                </div>
                <dl className={a.facts}>
                  <div>
                    <dt>مبنا</dt>
                    <dd>{formatToman(c.base_amount)} تومان</dd>
                  </div>
                  <div>
                    <dt>ثبت</dt>
                    <dd>{timeFa.format(c.created_at)}</dd>
                  </div>
                  {c.release_at && (
                    <div>
                      <dt>آزادسازی</dt>
                      <dd>{timeFa.format(c.release_at)}</dd>
                    </div>
                  )}
                  {c.paid_at && (
                    <div>
                      <dt>واریز</dt>
                      <dd>{timeFa.format(c.paid_at)}</dd>
                    </div>
                  )}
                  {c.cancel_reason && (
                    <div>
                      <dt>دلیل لغو</dt>
                      <dd>{c.cancel_reason}</dd>
                    </div>
                  )}
                </dl>
                {(c.status === 'pending' || c.status === 'approved') && (
                  <form action={decideCommissionAction} className={a.actions}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="back" value={here(data.page)} />
                    {c.order_status === 'sent' && (
                      <Button type="submit" name="decision" value="approve" size="sm" icon="check" data-commission-approve>
                        تأیید و واریز
                      </Button>
                    )}
                    <input name="reason" maxLength={300} placeholder="دلیل لغو" aria-label="دلیل لغو" className={a.reason} />
                    <Button type="submit" name="decision" value="cancel" size="sm" variant="outline" data-commission-cancel>
                      لغو
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={data.page} totalPages={data.page + (data.rows.length === 30 ? 1 : 0)} hrefFor={here} />
      </section>
    </Container>
  );
}
