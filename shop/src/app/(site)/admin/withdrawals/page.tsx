import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import type { WithdrawalStatus } from '@/lib/wallet/withdraw';
import { requireRole } from '@/server/auth/guards';
import { withdrawalService } from '@/server/services/withdrawal.service';
import { Alert, Breadcrumb, Button, EmptyState, Pagination } from '@/ui';
import s from '../../account/account.module.css';
import a from '../affiliates/admin-affiliates.module.css';
import { decideWithdrawalAction } from './actions';

export const metadata: Metadata = { title: 'درخواست‌های برداشت', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });
const TABS: Array<{ status: WithdrawalStatus | null; key: string; label: string }> = [
  { status: 'pending', key: 'pending', label: 'در انتظار' },
  { status: 'paid', key: 'paid', label: 'پرداخت‌شده' },
  { status: 'rejected', key: 'rejected', label: 'ردشده' },
  { status: 'canceled', key: 'canceled', label: 'لغوشده' },
  { status: null, key: 'all', label: 'همه' },
];

/** Withdrawal requests of affiliates: filter by status, the whole account number (admins only), «پرداخت شد» and «رد». */
export default async function AdminWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/withdrawals');
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.status) ?? TABS[0]!;
  const { rows, counts, page } = await withdrawalService.adminList(tab.status, Number(sp.page) || 1);
  const total = (st: WithdrawalStatus | null) =>
    st ? counts[st] : counts.pending + counts.paid + counts.rejected + counts.canceled;
  const hrefFor = (p: number) => `/admin/withdrawals?status=${tab.key}${p > 1 ? `&page=${p}` : ''}`;

  return (
    <div className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'برداشت‌ها' }]}
      />
      <section className={s.card} aria-labelledby="wd-title" style={{ maxWidth: 'none' }}>
        <h1 id="wd-title" className={s.title}>
          درخواست‌های برداشت
        </h1>
        <nav aria-label="وضعیت درخواست‌ها" className={a.tabs}>
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/withdrawals?status=${t.key}`}
              className={a.tab}
              aria-current={t.key === tab.key ? 'page' : undefined}
            >
              {t.label} ({toFaDigits(total(t.status))})
            </Link>
          ))}
        </nav>
        {sp.done === 'paid' && <Alert tone="success">ثبت شد: پرداخت‌شده.</Alert>}
        {sp.done === 'rejected' && <Alert tone="success">رد شد و مبلغ به کیف پول همکار برگشت.</Alert>}
        {typeof sp.error === 'string' && <Alert tone="danger">{sp.error}</Alert>}
        {rows.length === 0 ? (
          <EmptyState icon="check_circle" title="درخواستی در این بخش نیست." />
        ) : (
          <ul className={a.list}>
            {rows.map((r) => (
              <li key={r.id} className={a.item} data-withdrawal-id={r.id} data-status={r.status}>
                <div className={a.head}>
                  <b className="tnum">{formatToman(r.amount)} تومان</b>
                  <span dir="ltr">{toFaDigits(r.phone)}</span>
                  <span className={a.muted}>{timeFa.format(r.created_at)}</span>
                </div>
                <dl className={a.facts}>
                  <div>
                    <dt>صاحب حساب</dt>
                    <dd>{r.holder_name}</dd>
                  </div>
                  <div>
                    <dt>شبا</dt>
                    <dd dir="ltr" data-iban>
                      {r.iban}
                    </dd>
                  </div>
                  {r.paid_ref && (
                    <div>
                      <dt>کد پیگیری</dt>
                      <dd dir="ltr">{r.paid_ref}</dd>
                    </div>
                  )}
                  {r.reject_reason && (
                    <div>
                      <dt>دلیل رد</dt>
                      <dd>{r.reject_reason}</dd>
                    </div>
                  )}
                </dl>
                {r.status === 'pending' && (
                  <form action={decideWithdrawalAction} className={a.actions}>
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      name="ref"
                      maxLength={60}
                      placeholder="کد پیگیری بانکی"
                      aria-label="کد پیگیری بانکی"
                      className={a.reason}
                      dir="ltr"
                    />
                    <Button type="submit" name="decision" value="paid" size="sm" icon="check" data-wd-paid>
                      پرداخت شد
                    </Button>
                    <input
                      name="reason"
                      maxLength={300}
                      placeholder="دلیل رد"
                      aria-label="دلیل رد"
                      className={a.reason}
                    />
                    <Button type="submit" name="decision" value="reject" size="sm" variant="outline" data-wd-reject>
                      رد
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <Pagination page={page} totalPages={page + (rows.length === 30 ? 1 : 0)} hrefFor={hrefFor} />
      </section>
    </div>
  );
}
