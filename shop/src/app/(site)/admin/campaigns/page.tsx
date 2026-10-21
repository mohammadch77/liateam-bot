import type { Metadata } from 'next';
import Link from 'next/link';
import { toFaDigits } from '@/lib/format/number';
import { requireRole } from '@/server/auth/guards';
import { discountService } from '@/server/services/discount.service';
import { Breadcrumb, Container, EmptyState } from '@/ui';
import s from '../../account/account.module.css';
import a from '../admin-forms.module.css';
import { CampaignForm, type CampaignDraft } from './CampaignForm';

export const metadata: Metadata = { title: 'کمپین‌ها', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });
const local = (d: Date) => new Date(d.getTime() + 3.5 * 3600_000).toISOString().slice(0, 16);

/** Campaigns (the header bar and the offers countdown): list and new / edit form. Admins only. */
export default async function AdminCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/campaigns');
  const sp = await searchParams;
  const rows = await discountService.campaigns();
  const editing = rows.find((r) => r.id === Number(sp.edit)) ?? null;
  const draft: CampaignDraft = editing
    ? {
        id: editing.id,
        title: editing.title,
        bannerText: editing.banner_text,
        endsAt: local(editing.ends_at),
        link: editing.link,
        active: editing.active,
      }
    : { id: null, title: '', bannerText: '', endsAt: '', link: '/offers', active: true };
  const now = new Date();

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'کمپین‌ها' }]}
      />
      <section className={s.card} aria-labelledby="campaigns-title" style={{ maxWidth: 'none' }}>
        <h1 id="campaigns-title" className={s.title}>
          کمپین‌ها
        </h1>
        <nav className={a.links} aria-label="بخش‌های مدیریت تخفیف">
          <Link href="/admin/discounts">تخفیف‌ها</Link>
          {editing && <Link href="/admin/campaigns">کمپین جدید</Link>}
        </nav>
        <CampaignForm key={editing?.id ?? 'new'} draft={draft} />
        <h2 className={a.formTitle} style={{ marginTop: 20 }}>
          فهرست کمپین‌ها
        </h2>
        {rows.length === 0 ? (
          <EmptyState icon="bolt" title="هنوز کمپینی ساخته نشده است." />
        ) : (
          <div className={a.tableWrap}>
            <table className={a.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>وضعیت</th>
                  <th>عنوان</th>
                  <th>متن نوار</th>
                  <th>پایان</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const live = r.active && r.ends_at > now;
                  return (
                    <tr key={r.id} data-campaign={r.id}>
                      <td className="tnum">{toFaDigits(r.id)}</td>
                      <td>
                        <span className={live ? `${a.status} ${a.live}` : a.status}>
                          {live ? 'در حال اجرا' : r.active ? 'تمام‌شده' : 'غیرفعال'}
                        </span>
                      </td>
                      <td>{r.title}</td>
                      <td>{r.banner_text}</td>
                      <td className="tnum">{timeFa.format(r.ends_at)}</td>
                      <td>
                        <Link href={`/admin/campaigns?edit=${r.id}`}>ویرایش</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Container>
  );
}
