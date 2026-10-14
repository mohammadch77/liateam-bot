import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getConfig } from '@/lib/config';
import { safeNextPath } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/services/session.service';
import { LoginForm } from './LoginForm';
import s from './login.module.css';

export const metadata: Metadata = { title: 'ورود | ثبت‌نام', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <div className={s.page}>
      <section className={s.card} aria-labelledby="login-title">
        <span className={s.brand}>
          {getConfig().BRAND_NAME}
          <span className={s.dot}>.</span>
        </span>
        <LoginForm next={next} />
      </section>
    </div>
  );
}
