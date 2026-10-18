import type { Metadata } from 'next';
import Link from 'next/link';
import { toFaDigits } from '@/lib/format/number';
import type { AffiliateStatus } from '@/server/repositories/affiliate.repository';
import { requireRole } from '@/server/auth/guards';
import { CHANNEL_TYPES, FOLLOWERS, affiliateService } from '@/server/services/affiliate.service';
import { Alert, Breadcrumb, Button, Container, EmptyState } from '@/ui';
import s from '../../account/account.module.css';
import a from './admin-affiliates.module.css';
import { decideAffiliateAction } from './actions';

export const metadata: Metadata = { title: 'درخواست‌های همکاری در فروش', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });
const TABS: Array<{ status: AffiliateStatus; label: string }> = [
  { status: 'pending', label: 'در انتظار' },
  { status: 'approved', label: 'تأییدشده' },
  { status: 'rejected', label: 'ردشده' },
];
const SOURCE_LABEL: Record<string, string> = {
  home: 'صفحه اصلی',
  footer: 'فوتر',
  account: 'حساب',
  direct: 'مستقیم',
};

/** Applications to sell for the shop: approve (→ role «affiliate») or reject. All text is shown as plain text. */
export default async function AdminAffiliatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/affiliates');
  const sp = await searchParams;
  const status = TABS.find((t) => t.status === sp.status)?.status ?? 'pending';
  const [rows, counts] = await Promise.all([affiliateService.list(status), affiliateService.counts()]);

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'مدیریت', href: '/admin' },
          { label: 'همکاری در فروش' },
        ]}
      />
      <section className={s.card} aria-labelledby="aff-title" style={{ maxWidth: 'none' }}>
        <h1 id="aff-title" className={s.title}>
          درخواست‌های همکاری در فروش
        </h1>
        <nav aria-label="وضعیت درخواست‌ها" className={a.tabs}>
          {TABS.map((t) => (
            <Link
              key={t.status}
              href={`/admin/affiliates?status=${t.status}`}
              className={a.tab}
              aria-current={t.status === status ? 'page' : undefined}
            >
              {t.label} ({toFaDigits(counts[t.status])})
            </Link>
          ))}
        </nav>
        {sp.done === 'approved' && (
          <Alert tone="success">تأیید شد؛ نقش «فروشنده‌ی همکار» به کاربر داده شد.</Alert>
        )}
        {sp.done === 'rejected' && <Alert tone="success">درخواست رد شد.</Alert>}
        {sp.error && <Alert tone="danger">این درخواست پیدا نشد یا قبلاً بررسی شده است.</Alert>}
        {rows.length === 0 ? (
          <EmptyState icon="check_circle" title="درخواستی در این بخش نیست." />
        ) : (
          <ul className={a.list}>
            {rows.map((r) => (
              <li key={r.id} className={a.item} data-application={r.id}>
                <div className={a.head}>
                  <b>{r.full_name}</b>
                  <span dir="ltr">{toFaDigits(r.phone)}</span>
                  <span className={a.muted}>
                    {timeFa.format(r.created_at)} · از {SOURCE_LABEL[r.source] ?? r.source}
                  </span>
                </div>
                <dl className={a.facts}>
                  <div>
                    <dt>محل</dt>
                    <dd>
                      {r.province}، {r.city}
                    </dd>
                  </div>
                  <div>
                    <dt>کانال</dt>
                    <dd>
                      {CHANNEL_TYPES[r.channel_type]} · <span dir="ltr">{r.channel_url}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>دنبال‌کننده</dt>
                    <dd>{r.followers ? FOLLOWERS[r.followers] : '—'}</dd>
                  </div>
                </dl>
                <p className={a.description}>{r.description}</p>
                {r.status === 'rejected' && r.reject_reason && (
                  <p className={a.muted}>دلیل رد: {r.reject_reason}</p>
                )}
                {r.status === 'pending' && (
                  <form action={decideAffiliateAction} className={a.actions}>
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" name="decision" value="approve" size="sm" icon="check">
                      تأیید و ارتقای نقش
                    </Button>
                    <input
                      name="reason"
                      maxLength={300}
                      placeholder="دلیل رد (اختیاری)"
                      aria-label="دلیل رد (اختیاری)"
                      className={a.reason}
                    />
                    <Button type="submit" name="decision" value="reject" size="sm" variant="outline">
                      رد
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}
