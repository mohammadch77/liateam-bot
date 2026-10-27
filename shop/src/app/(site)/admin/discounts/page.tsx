import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { isLive } from '@/lib/pricing/discounts';
import { requireRole } from '@/server/auth/guards';
import type { DiscountRow } from '@/server/repositories/discount.repository';
import { toDiscount } from '@/server/repositories/discount.repository';
import { catalogService } from '@/server/services/catalog.service';
import { discountService } from '@/server/services/discount.service';
import { Alert, Breadcrumb, Button, Container, EmptyState } from '@/ui';
import s from '../../account/account.module.css';
import a from '../admin-forms.module.css';
import { toggleDiscountAction } from './actions';
import { DiscountForm, type DiscountDraft, type Option } from './DiscountForm';
import { offersPath } from '@/lib/urls';

export const metadata: Metadata = { title: 'تخفیف‌ها', robots: { index: false } };

const timeFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'short', timeStyle: 'short' });
const SCOPE_LABEL = { product: 'محصول', category: 'دسته', brand: 'برند', all: 'کل فروشگاه' } as const;

/** datetime-local value in Tehran time */
function local(d: Date | null): string {
  if (!d) return '';
  const t = new Date(d.getTime() + 3.5 * 3600_000);
  return t.toISOString().slice(0, 16);
}

function status(r: DiscountRow, now: Date): string {
  if (!r.active) return 'غیرفعال';
  if (r.ends_at && r.ends_at <= now) return 'تمام‌شده';
  if (r.starts_at > now) return 'زمان‌بندی‌شده';
  return isLive(toDiscount(r), now) ? 'در حال اجرا' : 'کمپین متوقف';
}

/** Our discounts: list (status, scope, value, period), new / edit form with a preview. Admins only. */
export default async function AdminDiscountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/discounts');
  const sp = await searchParams;
  const editId = Number(sp.edit) || null;
  const [rows, campaigns, categories, brands, productNames] = await Promise.all([
    discountService.list(),
    discountService.campaigns(),
    catalogService.allCategories(),
    catalogService.brands(),
    catalogService.productNames(),
  ]);
  const products: Option[] = productNames.map((p) => ({ value: String(p.id), label: p.name }));
  const now = new Date();
  const names = {
    category: new Map(categories.map((c) => [c.code, c.name])),
    brand: new Map(brands.map((b) => [b.code, b.name])),
    product: new Map(products.map((p) => [Number(p.value), p.label])),
  };
  const targetName = (r: { scope: DiscountRow['scope']; target_code: number | null }) =>
    r.scope === 'all' || r.target_code === null
      ? ''
      : (names[r.scope].get(r.target_code) ?? `#${toFaDigits(r.target_code)}`);
  const editing = editId ? (rows.find((r) => r.id === editId) ?? null) : null;
  const draft: DiscountDraft = editing
    ? {
        id: editing.id,
        scope: editing.scope,
        target: editing.target_code !== null ? `${editing.target_code} — ${targetName(editing)}` : '',
        kind: editing.kind,
        value: String(editing.value),
        startsAt: local(editing.starts_at),
        endsAt: local(editing.ends_at),
        label: editing.label ?? '',
        campaign: editing.campaign_id ? String(editing.campaign_id) : '',
        active: editing.active,
        allowLoss: editing.allow_loss,
      }
    : {
        id: null,
        scope: 'product',
        target: '',
        kind: 'percent',
        value: '',
        startsAt: '',
        endsAt: '',
        label: '',
        campaign: '',
        active: true,
        allowLoss: false,
      };

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'تخفیف‌ها' }]}
      />
      <section className={s.card} aria-labelledby="discounts-title" style={{ maxWidth: 'none' }}>
        <h1 id="discounts-title" className={s.title}>
          تخفیف‌ها
        </h1>
        <nav className={a.links} aria-label="بخش‌های مدیریت تخفیف">
          <Link href="/admin/campaigns">کمپین‌ها</Link>
          <Link href={offersPath()}>صفحه‌ی تخفیفات ویژه</Link>
          {editing && <Link href="/admin/discounts">تخفیف جدید</Link>}
        </nav>
        {sp.done === 'on' && <Alert tone="success">تخفیف فعال شد.</Alert>}
        {sp.done === 'off' && <Alert tone="success">تخفیف غیرفعال شد.</Alert>}
        {sp.error === 'DISCOUNT_UNSAFE' && <Alert tone="danger">تخفیف بیش از حد مجاز است.</Alert>}
        {sp.error && sp.error !== 'DISCOUNT_UNSAFE' && (
          <Alert tone="danger">انجام نشد؛ دوباره تلاش کنید.</Alert>
        )}

        <DiscountForm
          key={editing?.id ?? 'new'}
          draft={draft}
          products={products}
          categories={categories.map((c) => ({ value: String(c.code), label: c.name }))}
          brands={brands.map((b) => ({ value: String(b.code), label: b.name }))}
          campaigns={campaigns.map((c) => ({ value: String(c.id), label: c.title }))}
        />

        <h2 className={a.formTitle} style={{ marginTop: 20 }}>
          فهرست تخفیف‌ها
        </h2>
        {rows.length === 0 ? (
          <EmptyState icon="bolt" title="هنوز تخفیفی ساخته نشده است." />
        ) : (
          <div className={a.tableWrap}>
            <table className={a.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>وضعیت</th>
                  <th>دامنه</th>
                  <th>مقدار</th>
                  <th>بازه</th>
                  <th>برچسب / کمپین</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = status(r, now);
                  return (
                    <tr key={r.id} data-discount={r.id}>
                      <td className="tnum">{toFaDigits(r.id)}</td>
                      <td>
                        <span className={st === 'در حال اجرا' ? `${a.status} ${a.live}` : a.status}>
                          {st}
                        </span>
                      </td>
                      <td>
                        {SCOPE_LABEL[r.scope]}
                        {r.scope !== 'all' && `: ${targetName(r)}`}
                      </td>
                      <td className="tnum">
                        {r.kind === 'percent' ? `${toFaDigits(r.value)}٪` : `${formatToman(r.value)} تومان`}
                      </td>
                      <td className="tnum">
                        {timeFa.format(r.starts_at)} تا {r.ends_at ? timeFa.format(r.ends_at) : 'بدون پایان'}
                      </td>
                      <td>
                        {[r.label, r.campaign_title].filter(Boolean).join(' · ') || '—'}
                        {r.allow_loss && <span className={`${a.status} ${a.danger}`}> زیان مجاز</span>}
                      </td>
                      <td>
                        <div className={a.rowActions}>
                          <Link href={`/admin/discounts?edit=${r.id}`}>ویرایش</Link>
                          <form action={toggleDiscountAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="active" value={r.active ? '0' : '1'} />
                            <Button type="submit" size="sm" variant="outline">
                              {r.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                            </Button>
                          </form>
                        </div>
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
