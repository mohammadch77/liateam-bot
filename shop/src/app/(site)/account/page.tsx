import type { Metadata } from 'next';
import Link from 'next/link';
import { maskMobile } from '@/lib/phone';
import { requireUser } from '@/server/auth/guards';
import { hasRole } from '@/server/services/session.service';
import { Alert, Badge, Breadcrumb, Button, Container } from '@/ui';
import { logoutAction } from './actions';
import s from './account.module.css';

export const metadata: Metadata = { title: 'حساب کاربری', robots: { index: false } };

const ROLE_LABEL: Record<string, string> = {
  customer: 'مشتری',
  affiliate: 'همکار فروش',
  support: 'پشتیبان',
  employee: 'کارمند',
  admin: 'مدیر',
};

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

/** Protected example page: only a signed-in user gets here (others are sent to /login and back). */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser('/account');
  const { error } = await searchParams;

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری' }]} />
      <section className={s.card} aria-labelledby="account-title">
        <h1 id="account-title" className={s.title}>
          حساب کاربری
        </h1>
        {error === 'logout' && <Alert tone="danger">خروج انجام نشد. دوباره تلاش کنید.</Alert>}
        <dl className={s.list}>
          <div>
            <dt>شماره موبایل</dt>
            <dd dir="ltr">{maskMobile(user.phone)}</dd>
          </div>
          <div>
            <dt>نقش‌ها</dt>
            <dd className={s.roles}>
              {user.roles.map((r) => (
                <Badge key={r} tone={r === 'admin' ? 'new' : 'neutral'}>
                  {ROLE_LABEL[r] ?? r}
                </Badge>
              ))}
            </dd>
          </div>
          <div>
            <dt>اعتبار نشست تا</dt>
            <dd>{dateFa.format(user.sessionExpiresAt)}</dd>
          </div>
        </dl>
        <div className={s.actions}>
          {hasRole(user, 'admin') && (
            <Link href="/admin" className={s.adminLink}>
              ورود به بخش مدیریت
            </Link>
          )}
          <form action={logoutAction}>
            <Button type="submit" variant="outline" icon="close">
              خروج از حساب
            </Button>
          </form>
        </div>
      </section>
    </Container>
  );
}
