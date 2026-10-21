import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { requireRole } from '@/server/auth/guards';
import { catalogService } from '@/server/services/catalog.service';
import { PACK_POLICY, packPath, packService } from '@/server/services/pack.service';
import { Alert, Breadcrumb, Button, Container, EmptyState } from '@/ui';
import s from '../../account/account.module.css';
import a from '../admin-forms.module.css';
import { togglePackAction } from './actions';
import { CollectionForm, PackForm, type CollectionDraft, type PackDraft } from './PackForms';

export const metadata: Metadata = { title: 'پک‌ها', robots: { index: false } };

const local = (d: Date | null) =>
  d ? new Date(d.getTime() + 3.5 * 3600_000).toISOString().slice(0, 16) : '';

/** Pack collections («روتین پوستی») and their packs: list, new / edit with preview, switch off. Admins only. */
export default async function AdminPacksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/packs');
  const sp = await searchParams;
  const [{ collections, packs, items }, productNames] = await Promise.all([
    packService.adminData(),
    catalogService.productNames(),
  ]);
  const names = new Map(productNames.map((p) => [p.id, p.name]));
  const productLabel = (id: number | null) => (id ? `${id} — ${names.get(id) ?? 'فروخته نمی‌شود'}` : '');
  const editPack = packs.find((p) => p.id === Number(sp.pack)) ?? null;
  const editCollection = collections.find((c) => c.id === Number(sp.collection)) ?? null;
  const packDraft: PackDraft = editPack
    ? {
        id: editPack.id,
        collectionId: String(editPack.collection_id),
        variantKey: editPack.variant_key,
        variantTitle: editPack.variant_title,
        title: editPack.title,
        description: editPack.description,
        discountKind: editPack.discount_kind,
        discountValue: String(editPack.discount_value),
        active: editPack.active,
        allowLoss: editPack.allow_loss,
        startsAt: local(editPack.starts_at),
        endsAt: local(editPack.ends_at),
        sortOrder: String(editPack.sort_order),
        steps: items
          .filter((i) => i.pack_id === editPack.id)
          .map((i) => ({ label: i.step_label, product: productLabel(i.product_id) })),
      }
    : {
        id: null,
        collectionId: String(collections[0]?.id ?? ''),
        variantKey: '',
        variantTitle: '',
        title: '',
        description: '',
        discountKind: 'percent',
        discountValue: '',
        active: true,
        allowLoss: false,
        startsAt: '',
        endsAt: '',
        sortOrder: '0',
        steps: ['پاک‌کننده', 'تونر', 'سرم', 'کرم', 'ضدآفتاب'].map((label) => ({ label, product: '' })),
      };
  const collectionDraft: CollectionDraft = editCollection
    ? {
        id: editCollection.id,
        slug: editCollection.slug,
        title: editCollection.title,
        variantLabel: editCollection.variant_label,
        active: editCollection.active,
        sortOrder: String(editCollection.sort_order),
      }
    : { id: null, slug: '', title: '', variantLabel: '', active: true, sortOrder: '0' };

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'پک‌ها' }]}
      />
      <section className={s.card} aria-labelledby="packs-title" style={{ maxWidth: 'none' }}>
        <h1 id="packs-title" className={s.title}>
          پک‌ها و روتین‌ها
        </h1>
        <nav className={a.links} aria-label="بخش‌های مدیریت پک">
          <Link href="/admin/discounts">تخفیف‌ها</Link>
          {(editPack || editCollection) && <Link href="/admin/packs">پک جدید</Link>}
        </nav>
        {sp.done === 'on' && <Alert tone="success">پک فعال شد.</Alert>}
        {sp.done === 'off' && <Alert tone="success">پک غیرفعال شد.</Alert>}
        {sp.error && <Alert tone="danger">انجام نشد؛ دوباره تلاش کنید.</Alert>}

        {collections.length > 0 ? (
          <PackForm
            key={`pack-${editPack?.id ?? 'new'}`}
            draft={packDraft}
            collections={collections.map((c) => ({ value: String(c.id), label: c.title }))}
            products={productNames.map((p) => ({ value: String(p.id), label: p.name }))}
            maxSteps={PACK_POLICY.maxSteps}
          />
        ) : (
          <Alert tone="warning">اول یک مجموعه بسازید (مثلاً «روتین پوستی»).</Alert>
        )}

        {collections.length === 0 ? (
          <EmptyState icon="spa" title="هنوز مجموعه‌ای ساخته نشده است." />
        ) : (
          collections.map((c) => (
            <div key={c.id} data-collection={c.slug}>
              <h2 className={a.formTitle} style={{ marginTop: 22 }}>
                {c.title} <span className={a.status}>{c.active ? 'فعال' : 'غیرفعال'}</span>{' '}
                <Link href={`/admin/packs?collection=${c.id}`} style={{ fontSize: 13 }}>
                  ویرایش مجموعه
                </Link>
              </h2>
              <div className={a.tableWrap}>
                <table className={a.table}>
                  <thead>
                    <tr>
                      <th>{c.variant_label}</th>
                      <th>وضعیت</th>
                      <th>تخفیف پک</th>
                      <th>مراحل</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {packs
                      .filter((p) => p.collection_id === c.id)
                      .map((p) => (
                        <tr key={p.id} data-pack={p.variant_key}>
                          <td>
                            <Link href={packPath(c.slug, p.variant_key)}>{p.variant_title}</Link>
                          </td>
                          <td>
                            <span className={p.active ? `${a.status} ${a.live}` : a.status}>
                              {p.active ? 'فعال' : 'غیرفعال'}
                            </span>
                          </td>
                          <td className="tnum">
                            {p.discount_kind === 'percent'
                              ? `${toFaDigits(p.discount_value)}٪`
                              : `قیمت ثابت ${formatToman(p.discount_value)} تومان`}
                            {p.allow_loss && <span className={`${a.status} ${a.danger}`}> زیان مجاز</span>}
                          </td>
                          <td>
                            {items
                              .filter((i) => i.pack_id === p.id)
                              .map(
                                (i) =>
                                  `${i.step_label}: ${i.product_id ? (names.get(i.product_id) ?? '—') : 'به‌زودی'}`,
                              )
                              .join(' · ')}
                          </td>
                          <td>
                            <div className={a.rowActions}>
                              <Link href={`/admin/packs?pack=${p.id}`}>ویرایش</Link>
                              <form action={togglePackAction}>
                                <input type="hidden" name="id" value={p.id} />
                                <input type="hidden" name="active" value={p.active ? '0' : '1'} />
                                <Button type="submit" size="sm" variant="outline">
                                  {p.active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                                </Button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}

        <div style={{ marginTop: 24 }}>
          <CollectionForm key={`col-${editCollection?.id ?? 'new'}`} draft={collectionDraft} />
        </div>
      </section>
    </Container>
  );
}
