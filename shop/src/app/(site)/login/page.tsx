import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { safeNextPath } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/services/session.service';
import { Alert, Icon } from '@/ui';
import { LoginForm } from './LoginForm';
import s from './login.module.css';

export const metadata: Metadata = { title: 'ورود | ثبت‌نام', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  // an admin whose sign-in is too old comes here with ?expired=1 while still holding a valid cookie: show the form (a new
  // sign-in replaces that cookie) instead of bouncing back to the panel, which would send them here again
  if (sp.expired !== '1' && (await getCurrentUser())) redirect(next);

  return (
    <div className={s.page} data-auth-page>
      <div className={s.layout}>
        {/* desktop only: why sign in, beside the form */}
        <aside className={s.side} aria-hidden="true">
          <span className={s.sideBrand}>
            {getConfig().BRAND_NAME}
            <span className={s.dot}>.</span>
          </span>
          <ul className={s.perks}>
            <li>
              <Icon name="verified" size={22} />
              ضمانت اصالت همه‌ی کالاها
            </li>
            <li>
              <Icon name="local_shipping" size={22} />
              ارسال به سراسر ایران
            </li>
            <li>
              <Icon name="check_circle" size={22} />
              پیگیری سفارش‌ها در حساب کاربری
            </li>
          </ul>
        </aside>
        <section className={s.card} aria-labelledby="login-title">
          <span className={s.brand}>
            {getConfig().BRAND_NAME}
            <span className={s.dot}>.</span>
          </span>
          {sp.expired === '1' && (
            <Alert tone="warning">نشست مدیریت منقضی شد؛ برای ادامه دوباره وارد شوید.</Alert>
          )}
          <LoginForm next={next} />
        </section>
      </div>
    </div>
  );
}
