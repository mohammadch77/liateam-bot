import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { safeNextPath } from '@/server/auth/guards';
import { readReferralCode } from '@/server/auth/referral-cookie';
import { getCurrentUser } from '@/server/services/session.service';
import { Alert, Icon } from '@/ui';
import { LoginForm } from './LoginForm';
import s from './login.module.css';

export const metadata: Metadata = { title: 'ورود و ثبت‌نام', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string; mode?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  // an admin whose sign-in is too old comes here with ?expired=1 while still holding a valid cookie: show the form (a new
  // sign-in replaces that cookie) instead of bouncing back to the panel, which would send them here again
  if (sp.expired !== '1' && (await getCurrentUser())) redirect(next);

  const initialRefCode = (await readReferralCode().catch(() => null)) ?? '';
  const initialMode = sp.mode === 'register' ? 'register' : 'login';

  return (
    <div className={s.page} data-auth-page>
      <div className={s.layout}>
        {/* desktop only: why sign in, beside the form */}
        <aside className={s.side} aria-hidden="true">
          <div className={s.sideHeader}>
            <span className={s.sideBrand}>
              {getConfig().BRAND_NAME}
              <span className={s.dot}>.</span>
            </span>
            <p className={s.sideTagline}>تجربه خرید مطمئن محصولات آرایشی و مراقبتی اصل</p>
          </div>
          <ul className={s.perks}>
            <li>
              <span className={s.perkIcon}>
                <Icon name="verified" size={20} />
              </span>
              <span>ضمانت اصالت و سلامت همه‌ی کالاها</span>
            </li>
            <li>
              <span className={s.perkIcon}>
                <Icon name="local_shipping" size={20} />
              </span>
              <span>ارسال سریع به سراسر ایران</span>
            </li>
            <li>
              <span className={s.perkIcon}>
                <Icon name="check_circle" size={20} />
              </span>
              <span>پیگیری لحظه‌ای سفارش‌ها در حساب کاربری</span>
            </li>
          </ul>
        </aside>
        <section className={s.card} aria-labelledby="login-title">
          <div className={s.cardTop}>
            <span className={s.brand}>
              {getConfig().BRAND_NAME}
              <span className={s.dot}>.</span>
            </span>
          </div>
          {sp.expired === '1' && (
            <Alert tone="warning">نشست مدیریت منقضی شد؛ برای ادامه دوباره وارد شوید.</Alert>
          )}
          <LoginForm next={next} initialRefCode={initialRefCode} initialMode={initialMode} />
        </section>
      </div>
    </div>
  );
}
