import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { ORDER_STATUS_LABEL } from '@/lib/orders/filters';
import { maskMobile } from '@/lib/phone';
import { orderPath, ordersPath, walletPath } from '@/lib/urls';
import { requireUser } from '@/server/auth/guards';
import { accountService } from '@/server/services/account.service';
import { hasRole } from '@/server/services/session.service';
import { Alert, Badge, Breadcrumb, Button, EmptyState } from '@/ui';
import { logoutAction } from './actions';
import s from './account.module.css';

export const metadata: Metadata = { title: 'حساب کاربری', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

/** The panel's dashboard: current orders, the wallet balance and the last order. Only the signed-in user's own data. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser('/account');
  const { error } = await searchParams;
  const sum = await accountService.summary(user.id).catch(() => null);

  return (
    <>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری' }]} />
      <div className={s.head}>
        <h1 id="account-title" className={s.title}>
          {user.fullName ? `سلام ${user.fullName}` : 'حساب کاربری'}
        </h1>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            خروج از حساب
          </Button>
        </form>
      </div>
      {error === 'logout' && <Alert tone="danger">خروج انجام نشد. دوباره تلاش کنید.</Alert>}
      {!sum ? (
        <EmptyState icon="error" tone="danger" title="خلاصه‌ی حساب بارگذاری نشد">
          چند لحظه بعد صفحه را دوباره باز کنید.
        </EmptyState>
      ) : (
        <>
          <section className={s.stats} aria-label="خلاصه‌ی حساب" data-account-summary>
            <Link href={ordersPath()} className={s.stat}>
              <span>سفارش‌های جاری</span>
              <b data-stat-active>{toFaDigits(sum.active)}</b>
            </Link>
            <Link href={walletPath()} className={s.stat}>
              <span>موجودی کیف پول</span>
              <b data-stat-balance>{formatToman(sum.balance)} تومان</b>
            </Link>
            <div className={s.stat}>
              <span>شماره موبایل</span>
              <b dir="ltr">{maskMobile(user.phone)}</b>
            </div>
          </section>
          <section className={`${s.card} ${s.wide}`} aria-labelledby="last-order-title">
            <h2 id="last-order-title" className={s.h2}>
              آخرین سفارش
            </h2>
            {sum.last ? (
              <div className={s.row}>
                <div className={s.rowMain}>
                  <b>{toFaDigits(sum.last.number)}</b>
                  <span className={s.muted}>
                    {dateFa.format(sum.last.created_at)} · {formatToman(sum.last.total_payable)} تومان
                  </span>
                </div>
                <Badge tone="neutral">{ORDER_STATUS_LABEL[sum.last.status]}</Badge>
                <Button href={orderPath(sum.last.number)} variant="outline" size="sm">
                  مشاهده
                </Button>
              </div>
            ) : (
              <EmptyState
                icon="shopping_bag"
                title="هنوز سفارشی ثبت نکرده‌اید"
                action={<Button href="/shop">رفتن به فروشگاه</Button>}
              />
            )}
          </section>
        </>
      )}
      <div className={s.btnRow}>
        {!user.roles.includes('affiliate') && (
          <Link href="/affiliate?from=account" className={s.adminLink}>
            همکاری در فروش
          </Link>
        )}
        {hasRole(user, 'admin') && (
          <Link href="/admin" className={s.adminLink}>
            ورود به بخش مدیریت
          </Link>
        )}
      </div>
    </>
  );
}
