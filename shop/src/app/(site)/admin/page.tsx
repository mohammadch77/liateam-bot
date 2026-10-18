import type { Metadata } from 'next';
import Link from 'next/link';
import { requireRole } from '@/server/auth/guards';
import { auditService } from '@/server/services/audit.service';
import { Breadcrumb, Container } from '@/ui';
import s from '../account/account.module.css';

export const metadata: Metadata = { title: 'مدیریت', robots: { index: false } };

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'ورود',
  'auth.logout': 'خروج',
  'auth.locked': 'قفل به‌دلیل تلاش ناموفق',
  'role.grant': 'اعطای نقش',
  'review.submit': 'ثبت دیدگاه',
  'review.approve': 'تأیید دیدگاه',
  'review.reject': 'رد دیدگاه',
};
const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });

/** Role-restricted example: admins only (everyone else gets HTTP 403). Placeholder for the phase-3 admin panel. */
export default async function AdminPage() {
  await requireRole('admin', '/admin');
  const events = await auditService.recent(20);

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت' }]} />
      <section className={s.card} aria-labelledby="admin-title" style={{ maxWidth: 'none' }}>
        <h1 id="admin-title" className={s.title}>
          مدیریت — رویدادهای امنیتی اخیر
        </h1>
        <p>
          <Link href="/admin/reviews">دیدگاه‌های در انتظار تأیید</Link>
        </p>
        <dl className={s.list}>
          {events.map((e) => (
            <div key={e.id}>
              <dt>
                {timeFa.format(e.created_at)} · کاربر #{e.actor_user_id ?? 'سیستم'}
              </dt>
              <dd>
                {ACTION_LABEL[e.action] ?? e.action}
                {typeof e.meta.role === 'string' && ` (${e.meta.role})`}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </Container>
  );
}
