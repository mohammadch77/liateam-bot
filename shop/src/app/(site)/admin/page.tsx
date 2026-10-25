import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber } from '@/lib/format/number';
import { healthService } from '@/server/services/health.service';
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
  'affiliate.apply': 'درخواست همکاری در فروش',
  'affiliate.approve': 'تأیید همکاری در فروش',
  'affiliate.reject': 'رد همکاری در فروش',
  'discount.create': 'ساخت تخفیف',
  'discount.update': 'ویرایش تخفیف',
  'discount.enable': 'فعال‌سازی تخفیف',
  'discount.disable': 'غیرفعال‌سازی تخفیف',
  'campaign.create': 'ساخت کمپین',
  'campaign.update': 'ویرایش کمپین',
  'pack.create': 'ساخت پک',
  'pack.update': 'ویرایش پک',
  'pack.enable': 'فعال‌سازی پک',
  'pack.disable': 'غیرفعال‌سازی پک',
  'pack.seed': 'ساخت پک‌های اولیه',
  'bestseller.add': 'افزودن به پرفروش‌ترین‌ها',
  'bestseller.move': 'جابه‌جایی در پرفروش‌ترین‌ها',
  'bestseller.enable': 'روشن کردن انتخاب پرفروش',
  'bestseller.disable': 'خاموش کردن انتخاب پرفروش',
  'setting.update': 'تغییر تنظیمات',
  'pack_collection.create': 'ساخت مجموعه‌ی پک',
  'pack_collection.update': 'ویرایش مجموعه‌ی پک',
};
const SYNC_STATUS: Record<string, string> = { ok: 'موفق', warning: 'با هشدار', failed: 'ناموفق' };
const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });

/** Role-restricted example: admins only (everyone else gets HTTP 403). Placeholder for the phase-3 admin panel. */
export default async function AdminPage() {
  await requireRole('admin', '/admin');
  const [events, sync] = await Promise.all([
    auditService.recent(20),
    healthService.syncStatus().catch(() => null),
  ]);
  const when = (d: Date | null) => (d ? timeFa.format(d) : '—');

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت' }]} />
      <section className={s.card} aria-labelledby="admin-title" style={{ maxWidth: 'none' }}>
        <h1 id="admin-title" className={s.title}>
          مدیریت
        </h1>
        <p>
          <Link href="/admin/reviews">دیدگاه‌های در انتظار تأیید</Link>
          {' · '}
          <Link href="/admin/affiliates">درخواست‌های همکاری در فروش</Link>
          {' · '}
          <Link href="/admin/discounts">تخفیف‌ها</Link>
          {' · '}
          <Link href="/admin/campaigns">کمپین‌ها</Link>
          {' · '}
          <Link href="/admin/packs">پک‌ها</Link>
          {' · '}
          <Link href="/admin/bestsellers">پرفروش‌ترین‌ها</Link>
          {' · '}
          <Link href="/admin/settings">تنظیمات</Link>
        </p>
      </section>

      <section className={s.card} aria-labelledby="sync-title" style={{ maxWidth: 'none' }} data-sync-status>
        <h2 id="sync-title" className={s.title}>
          وضعیت همگام‌سازی
        </h2>
        {sync ? (
          <dl className={s.list}>
            <div>
              <dt>آخرین همگام‌سازی کاتالوگ</dt>
              <dd>
                {when(sync.lastSyncAt)} (
                {SYNC_STATUS[sync.lastSyncStatus ?? ''] ?? sync.lastSyncStatus ?? '—'})
              </dd>
            </div>
            <div>
              <dt>آخرین همگام‌سازی موفق</dt>
              <dd>{when(sync.lastOkAt)}</dd>
            </div>
            <div>
              <dt>محصولات قابل نمایش</dt>
              <dd>{formatNumber(sync.products)}</dd>
            </div>
            <div>
              <dt>رویدادهای تغییر در ۲۴ ساعت اخیر</dt>
              <dd>{formatNumber(sync.events24h)}</dd>
            </div>
            <div>
              <dt>آخرین تازه‌سازی صفحه‌ها (revalidate)</dt>
              <dd>{when(sync.lastRevalidateAt)}</dd>
            </div>
            <div>
              <dt>زمان‌بندی</dt>
              <dd>{sync.paused ? 'متوقف (از داشبورد ربات)' : 'در حال اجرا'}</dd>
            </div>
          </dl>
        ) : (
          <p>وضعیت ربات در دسترس نیست (فایل ۰۱۳ دسترسی‌ها روی سرور اجرا نشده یا دیتابیس پاسخ نمی‌دهد).</p>
        )}
      </section>

      <section className={s.card} aria-labelledby="audit-title" style={{ maxWidth: 'none' }}>
        <h2 id="audit-title" className={s.title}>
          رویدادهای امنیتی اخیر
        </h2>
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
