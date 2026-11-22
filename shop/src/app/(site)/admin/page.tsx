import type { Metadata } from 'next';
import Link from 'next/link';
import { NO_COUNTS } from '@/lib/admin-nav';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { adminSettingsPath } from '@/lib/urls';
import { requireRole } from '@/server/auth/guards';
import { adminNavService } from '@/server/services/admin-nav.service';
import { auditService } from '@/server/services/audit.service';
import { commissionAdminService } from '@/server/services/commission-admin.service';
import { healthService } from '@/server/services/health.service';
import { orderService } from '@/server/services/order.service';
import { withdrawalService } from '@/server/services/withdrawal.service';
import { Breadcrumb, Icon } from '@/ui';
import type { IconName } from '@/ui/icon/paths';
import s from './admin-dashboard.module.css';

export const metadata: Metadata = { title: 'مدیریت', robots: { index: false } };

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'ورود به حساب',
  'auth.logout': 'خروج از حساب',
  'auth.locked': 'قفل به‌دلیل تلاش ناموفق',
  'auth.password_reset': 'تغییر رمز عبور',
  'auth.password_failed': 'تلاش ناموفق ورود با رمز',
  'role.grant': 'اعطای نقش',
  'role.revoke': 'لغو نقش',
  'secret.update': 'تعویض کلید رمزنگاری‌شده',
  'shipping.update': 'تغییر تنظیمات ارسال',
  'review.submit': 'ثبت دیدگاه',
  'commission.approve': 'تأیید و واریز پورسانت',
  'commission.cancel': 'لغو پورسانت',
  'withdrawal.request': 'درخواست برداشت',
  'withdrawal.paid': 'پرداخت برداشت',
  'withdrawal.reject': 'رد برداشت',
  'withdrawal.cancel': 'لغو برداشت',
  'review.approve': 'تأیید دیدگاه',
  'review.reject': 'رد دیدگاه',
  'affiliate.apply': 'درخواست همکاری در فروش',
  'referral.enter': 'ثبت کد معرف',
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
  'pack.discount_reset': 'بازنشانی تخفیف پک',
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

type QuickModule = {
  href: string;
  title: string;
  desc: string;
  icon: IconName;
  count?: number;
};

export default async function AdminPage() {
  const user = await requireRole('admin', '/admin');
  const [events, sync, previous, attention, pendingWithdrawals, manualCommissions, noRule, counts] =
    await Promise.all([
      auditService.recent(20),
      healthService.syncStatus().catch(() => null),
      auditService.previousLogin().catch(() => null),
      orderService.needingAttention().catch(() => []),
      withdrawalService.pendingCount().catch(() => 0),
      commissionAdminService.awaitingManual().catch(() => 0),
      commissionAdminService.noUsableRule().catch(() => false),
      adminNavService.counts(true).catch(() => NO_COUNTS),
    ]);

  const when = (d: Date | null) => (d ? timeFa.format(d) : '—');

  const modules: QuickModule[] = [
    {
      href: '/admin/orders',
      title: 'سفارش‌ها',
      desc: 'بررسی، پیگیری و ثبت نهایی سفارش‌ها',
      icon: 'shopping_bag',
      count: counts.attention,
    },
    {
      href: '/admin/reviews',
      title: 'دیدگاه‌ها',
      desc: 'تأیید و مدیریت نظرات مشتریان',
      icon: 'star',
      count: counts.reviews,
    },
    {
      href: '/admin/affiliates',
      title: 'همکاری در فروش',
      desc: 'درخواست‌ها و مدیریت همکاران',
      icon: 'verified',
      count: counts.affiliates,
    },
    {
      href: '/admin/withdrawals',
      title: 'برداشت‌ها',
      desc: 'تسویه حساب و درخواست‌های برداشت',
      icon: 'account_balance_wallet',
      count: counts.withdrawals,
    },
    {
      href: '/admin/commissions',
      title: 'پورسانت‌ها',
      desc: 'بررسی و تأیید پورسانت‌های فروش',
      icon: 'trending_up',
      count: counts.commissions,
    },
    {
      href: '/admin/discounts',
      title: 'تخفیف‌ها',
      desc: 'قیمت‌گذاری و تخفیف محصولات',
      icon: 'bolt',
    },
    {
      href: '/admin/campaigns',
      title: 'کمپین‌ها',
      desc: 'تنظیم و زمان‌بندی کمپین‌های فروش',
      icon: 'spa',
    },
    {
      href: '/admin/packs',
      title: 'پک‌های کاربردی',
      desc: 'ساخت و چیدمان روتین‌ها و پک‌ها',
      icon: 'inventory_2',
    },
    {
      href: '/admin/bestsellers',
      title: 'پرفروش‌ترین‌ها',
      desc: 'مدیریت ویترین محصولات پرفروش',
      icon: 'brush',
    },
    {
      href: adminSettingsPath(),
      title: 'تنظیمات',
      desc: 'ارسال، درگاه پیامک و قوانین فروشگاه',
      icon: 'lock',
    },
  ];

  const totalAlerts =
    (noRule ? 1 : 0) +
    (manualCommissions > 0 ? 1 : 0) +
    (pendingWithdrawals > 0 ? 1 : 0) +
    attention.length;

  return (
    <div className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت' }]} />

      {/* ── Hero + Quick-Access Modules Grid ── */}
      <section className={s.heroCard} aria-labelledby="admin-title" data-admin-overview>
        <div className={s.heroTop}>
          <div className={s.heroIntro}>
            <h1 id="admin-title" className={s.heroTitle}>
              مدیریت فروشگاه
              <span className={s.heroBadge}>پنل مدیر</span>
            </h1>
            <p className={s.heroSubtitle}>
              دسترسی سریع به بخش‌های اصلی مدیریت سفارش‌ها، فروش، پک‌ها و تنظیمات فروشگاه
            </p>
          </div>
          <p className={s.sessionMeta} data-last-login>
            <Icon name="history" size={16} className={s.sessionMetaIcon} />
            <span>
              {previous
                ? `ورود قبلی: ${when(previous.at)}${previous.ip ? ` (IP ${previous.ip})` : ''}`
                : 'این اولین ورود شماست.'}
            </span>
            <span className={s.sessionSep} aria-hidden="true">
              |
            </span>
            <span>ورود فعلی: {when(user.sessionCreatedAt)}</span>
          </p>
        </div>

        <nav className={s.modulesGrid} aria-label="بخش‌های مدیریت" data-admin-modules>
          {modules.map((m) => (
            <Link key={m.href} href={m.href} className={s.moduleCard}>
              <div className={s.moduleTop}>
                <span className={s.moduleIconWrap} aria-hidden="true">
                  <Icon name={m.icon} size={21} />
                </span>
                {m.count && m.count > 0 ? (
                  <span className={s.moduleCount}>{toFaDigits(m.count)}</span>
                ) : (
                  <Icon name="chevron_left" size={18} className={s.moduleArrow} />
                )}
              </div>
              <div className={s.moduleBody}>
                <span className={s.moduleTitle}>{m.title}</span>
                <span className={s.moduleDesc}>{m.desc}</span>
              </div>
            </Link>
          ))}
        </nav>
      </section>

      {/* ── Attention & Action Queue ── */}
      <section className={s.sectionCard} aria-labelledby="attention-title" data-attention>
        <div className={s.sectionHead}>
          <div className={s.sectionTitleWrap}>
            <span className={s.sectionIcon} aria-hidden="true">
              <Icon name="notifications" size={19} />
            </span>
            <h2 id="attention-title" className={s.sectionTitle}>
              نیازمند توجه
            </h2>
          </div>
          {totalAlerts > 0 ? (
            <span className={`${s.statusPill} ${s.pillDanger}`}>
              {toFaDigits(totalAlerts)} مورد فعال
            </span>
          ) : (
            <span className={`${s.statusPill} ${s.pillSuccess}`}>همه‌چیز مرتب است</span>
          )}
        </div>

        {(noRule || manualCommissions > 0 || pendingWithdrawals > 0 || attention.length > 0) && (
          <div className={s.alertStack}>
            {noRule && (
              <Link
                href="/admin/settings?section=commission"
                className={s.alertLink}
                data-attention-no-rule
              >
                <span className={s.alertLinkInner}>
                  <Icon name="warning" size={18} />
                  <span>هیچ قاعده‌ی پورسانت فعالی نیست؛ پورسانت ساخته نمی‌شود</span>
                </span>
                <Icon name="chevron_left" size={18} />
              </Link>
            )}
            {manualCommissions > 0 && (
              <Link
                href="/admin/commissions?status=pending"
                className={`${s.alertLink} ${s.alertLinkWarn}`}
                data-attention-commissions
              >
                <span className={s.alertLinkInner}>
                  <Icon name="trending_up" size={18} />
                  <span>{toFaDigits(manualCommissions)} پورسانت منتظر تأیید دستی است</span>
                </span>
                <Icon name="chevron_left" size={18} />
              </Link>
            )}
            {pendingWithdrawals > 0 && (
              <Link
                href="/admin/withdrawals?status=pending"
                className={`${s.alertLink} ${s.alertLinkWarn}`}
                data-attention-withdrawals
              >
                <span className={s.alertLinkInner}>
                  <Icon name="account_balance_wallet" size={18} />
                  <span>{toFaDigits(pendingWithdrawals)} درخواست برداشت در انتظار بررسی است</span>
                </span>
                <Icon name="chevron_left" size={18} />
              </Link>
            )}
            {attention.length > 0 && (
              <Link
                href="/admin/orders?status=action"
                className={s.alertLink}
                data-attention-orders-count
              >
                <span className={s.alertLinkInner}>
                  <Icon name="shopping_bag" size={18} />
                  <span>{toFaDigits(attention.length)} سفارش نیازمند اقدام اپراتور است</span>
                </span>
                <Icon name="chevron_left" size={18} />
              </Link>
            )}
          </div>
        )}

        {attention.length > 0 ? (
          <ul className={s.ordersList}>
            {attention.map((o) => {
              const reason =
                o.cancel_requested && ['placing', 'awaiting_payment'].includes(o.status)
                  ? 'مشتری درخواست لغو داده است (سفارش در حال ثبت یا ثبت‌شده نزد لیاتیم است)؛ پس از بررسی، لغو و بازگشت وجه را اپراتور تأیید می‌کند'
                  : o.status === 'awaiting_payment'
                    ? o.link_expiring
                      ? 'مهلت لینک پرداخت لیاتیم رو به پایان است یا تمام شده؛ پرداخت نهایی یا ثبت دوباره لازم است'
                      : 'ثبت‌شده نزد لیاتیم و منتظر پرداخت نهایی اپراتور'
                    : o.status === 'needs_review'
                      ? `متوقف برای بررسی${o.needs_review_reason ? `: ${o.needs_review_reason}` : ''}`
                      : 'پرداخت‌شده و هنوز در صف ثبت (بیش از حد انتظار)';
              return (
                <li key={o.number} data-attention-order={o.number}>
                  <Link href={`/admin/orders/${o.number}`} className={s.orderRow}>
                    <div className={s.orderMain}>
                      <span className={s.orderCode}>{o.number}</span>
                      <span className={s.orderTime}>پرداخت: {when(o.paid_at)}</span>
                    </div>
                    <div className={s.orderRight}>
                      <span className={s.orderReason}>{reason}</span>
                      <Icon name="chevron_left" size={18} className={s.orderChevron} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={s.allClear}>
            <Icon name="check_circle" size={20} />
            <span>سفارشی منتظر بررسی نیست.</span>
          </div>
        )}
      </section>

      {/* ── Sync Status KPI Grid ── */}
      <section className={s.sectionCard} aria-labelledby="sync-title" data-sync-status>
        <div className={s.sectionHead}>
          <div className={s.sectionTitleWrap}>
            <span className={s.sectionIcon} aria-hidden="true">
              <Icon name="refresh" size={19} />
            </span>
            <h2 id="sync-title" className={s.sectionTitle}>
              وضعیت همگام‌سازی
            </h2>
          </div>
          {sync && (
            <span className={`${s.statusPill} ${sync.paused ? s.pillWarning : s.pillSuccess}`}>
              {sync.paused ? 'متوقف (از داشبورد ربات)' : 'در حال اجرا'}
            </span>
          )}
        </div>

        {sync ? (
          <div className={s.statsGrid}>
            <div className={s.statTile}>
              <span className={s.statLabel}>محصولات قابل نمایش</span>
              <span className={`${s.statValue} ${s.statValueBig}`}>{formatNumber(sync.products)}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statLabel}>رویدادهای تغییر (۲۴ ساعت اخیر)</span>
              <span className={`${s.statValue} ${s.statValueBig}`}>{formatNumber(sync.events24h)}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statLabel}>آخرین همگام‌سازی کاتالوگ</span>
              <span className={s.statValue}>
                {when(sync.lastSyncAt)} (
                {SYNC_STATUS[sync.lastSyncStatus ?? ''] ?? sync.lastSyncStatus ?? '—'})
              </span>
            </div>
            <div className={s.statTile}>
              <span className={s.statLabel}>آخرین همگام‌سازی موفق</span>
              <span className={s.statValue}>{when(sync.lastOkAt)}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statLabel}>آخرین تازه‌سازی صفحه‌ها</span>
              <span className={s.statValue}>{when(sync.lastRevalidateAt)}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.statLabel}>زمان‌بندی ربات</span>
              <span className={s.statValue}>{sync.paused ? 'متوقف' : 'فعال و منظم'}</span>
            </div>
          </div>
        ) : (
          <p className={s.heroSubtitle}>
            وضعیت ربات در دسترس نیست (فایل ۰۱۳ دسترسی‌ها روی سرور اجرا نشده یا دیتابیس پاسخ نمی‌دهد).
          </p>
        )}
      </section>

      {/* ── Recent Security Events Feed ── */}
      <section className={s.sectionCard} aria-labelledby="audit-title">
        <div className={s.sectionHead}>
          <div className={s.sectionTitleWrap}>
            <span className={s.sectionIcon} aria-hidden="true">
              <Icon name="lock" size={19} />
            </span>
            <h2 id="audit-title" className={s.sectionTitle}>
              رویدادهای امنیتی اخیر
            </h2>
          </div>
          <span className={`${s.statusPill} ${s.pillNeutral}`}>{toFaDigits(events.length)} رویداد آخر</span>
        </div>

        <ul className={s.auditList}>
          {events.map((e) => (
            <li key={e.id} className={s.auditRow}>
              <span className={s.auditAction}>
                <span className={s.auditDot} aria-hidden="true" />
                <span>
                  {ACTION_LABEL[e.action] ?? e.action}
                  {typeof e.meta.role === 'string' && ` (${e.meta.role})`}
                </span>
              </span>
              <span className={s.auditMeta}>
                <span className={s.auditUser}>
                  {e.actor_user_id ? `کاربر #${toFaDigits(e.actor_user_id)}` : 'سیستم'}
                </span>
                <span>{timeFa.format(e.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
