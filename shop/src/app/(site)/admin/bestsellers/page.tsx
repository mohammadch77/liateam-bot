import type { Metadata } from 'next';
import Link from 'next/link';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { BESTSELLER_LIMIT, BESTSELLER_TABS, isTabKey } from '@/lib/bestsellers';
import { requireRole } from '@/server/auth/guards';
import { bestsellerService } from '@/server/services/bestseller.service';
import { Alert, Breadcrumb, Button, Container, EmptyState } from '@/ui';
import s from '../../account/account.module.css';
import a from '../admin-forms.module.css';
import { addPickAction, pickAction, useTagAction } from './actions';

export const metadata: Metadata = { title: 'پرفروش‌ترین‌ها', robots: { index: false } };

const SOURCE = { manual: 'انتخاب شما', liateam: 'برچسب پرفروش لیاتیم', fill: 'تکمیلی' } as const;
const DONE: Record<string, string> = {
  added: 'به فهرست اضافه شد.',
  up: 'جابه‌جا شد.',
  down: 'جابه‌جا شد.',
  on: 'دوباره روشن شد.',
  off: 'از فهرست برداشته شد (خاموش).',
  'tag-on': 'برچسب پرفروش لیاتیم استفاده می‌شود.',
  'tag-off': 'برچسب پرفروش لیاتیم استفاده نمی‌شود.',
};

/**
 * Home «پرفروش‌ترین‌ها» per tab: the admin's picks (add by search, reorder, switch off — never deleted), the Liateam
 * best-selling tag switch, and the final 10 as the home page shows them. Admins only.
 */
export default async function AdminBestsellersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/bestsellers');
  const sp = await searchParams;
  const tab = isTabKey(sp.tab) ? sp.tab : 'all';
  const def = BESTSELLER_TABS.find((t) => t.key === tab)!;
  const data = await bestsellerService.adminTab(tab);
  const enabled = data.picks.filter((p) => p.enabled);
  const off = data.picks.filter((p) => !p.enabled);

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'مدیریت', href: '/admin' },
          { label: 'پرفروش‌ترین‌ها' },
        ]}
      />
      <section className={s.card} aria-labelledby="bs-title" style={{ maxWidth: 'none' }}>
        <h1 id="bs-title" className={s.title}>
          پرفروش‌ترین‌های صفحه‌ی اصلی
        </h1>
        <nav className={a.links} aria-label="تب‌ها">
          {BESTSELLER_TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/bestsellers?tab=${t.key}`}
              aria-current={t.key === tab ? 'page' : undefined}
              className={t.key === tab ? `${a.status} ${a.live}` : a.status}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {typeof sp.done === 'string' && DONE[sp.done] && <Alert tone="success">{DONE[sp.done]}</Alert>}
        {typeof sp.error === 'string' && (
          <Alert tone="danger">{sp.error || 'انجام نشد؛ دوباره تلاش کنید.'}</Alert>
        )}
        <p className={a.hint}>
          ترتیب نمایش: اول انتخاب‌های شما (به همین ترتیب)، بعد محصولات دارای برچسب «پرفروش» لیاتیم، و اگر کمتر
          از {toFaDigits(BESTSELLER_LIMIT)} شد با محصولات موجود همین تب (اول برچسب «محبوب» لیاتیم، بعد بیشترین
          دیدگاه و امتیاز، بعد جدیدترین). فقط محصولات موجود نمایش داده می‌شوند.
        </p>

        <form action={useTagAction} className={a.rowActions} data-use-tag={data.useLiateamTag ? 'on' : 'off'}>
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="on" value={data.useLiateamTag ? '0' : '1'} />
          <span>
            برچسب «پرفروش» لیاتیم در تب «{def.label}»:{' '}
            <b>{data.useLiateamTag ? 'استفاده می‌شود' : 'استفاده نمی‌شود'}</b>
          </span>
          <Button type="submit" size="sm" variant="outline">
            {data.useLiateamTag ? 'خاموش کردن' : 'روشن کردن'}
          </Button>
        </form>

        <form
          action={addPickAction}
          className={a.form}
          aria-labelledby="add-pick-title"
          style={{ marginTop: 12 }}
        >
          <h2 id="add-pick-title" className={a.formTitle}>
            افزودن به انتخاب‌های «{def.label}»
          </h2>
          <input type="hidden" name="tab" value={tab} />
          <label className={a.field}>
            <span>محصول (نام یا کد را بنویسید)</span>
            <input name="product" list="bs-products" autoComplete="off" required />
          </label>
          <datalist id="bs-products">
            {data.products.map((p) => (
              <option key={p.id} value={`${p.id} — ${p.name}`} />
            ))}
          </datalist>
          <div className={a.actions}>
            <Button type="submit" icon="add">
              افزودن
            </Button>
          </div>
        </form>

        <h2 className={a.formTitle} style={{ marginTop: 20 }}>
          انتخاب‌های شما ({toFaDigits(enabled.length)})
        </h2>
        {enabled.length === 0 ? (
          <EmptyState
            icon="star"
            title="انتخاب دستی‌ای ندارید؛ فهرست از برچسب لیاتیم و محصولات تکمیلی ساخته می‌شود."
          />
        ) : (
          <ol className={a.pickList} data-picks>
            {enabled.map((p, i) => (
              <li key={p.id} data-pick={p.product_id}>
                <span className="tnum">{toFaDigits(i + 1)}.</span>
                <span className={a.pickName}>
                  {p.name} <small className="tnum">#{toFaDigits(p.product_id)}</small>
                </span>
                {(['up', 'down', 'off'] as const).map((op) => (
                  <form key={op} action={pickAction}>
                    <input type="hidden" name="tab" value={tab} />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="op" value={op} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={(op === 'up' && i === 0) || (op === 'down' && i === enabled.length - 1)}
                      aria-label={`${op === 'up' ? 'بالا' : op === 'down' ? 'پایین' : 'برداشتن'}: ${p.name}`}
                    >
                      {op === 'up' ? 'بالا' : op === 'down' ? 'پایین' : 'برداشتن'}
                    </Button>
                  </form>
                ))}
              </li>
            ))}
          </ol>
        )}
        {off.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary>برداشته‌شده‌ها ({toFaDigits(off.length)})</summary>
            <ul className={a.pickList}>
              {off.map((p) => (
                <li key={p.id}>
                  <span className={a.pickName}>{p.name}</span>
                  <form action={pickAction}>
                    <input type="hidden" name="tab" value={tab} />
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="op" value="on" />
                    <Button type="submit" size="sm" variant="outline">
                      برگرداندن
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}

        <h2 className={a.formTitle} style={{ marginTop: 20 }}>
          پیش‌نمایش: {toFaDigits(data.preview.length)} محصولی که صفحه‌ی اصلی نشان می‌دهد
        </h2>
        <div className={a.tableWrap}>
          <table className={a.table} data-preview>
            <thead>
              <tr>
                <th>#</th>
                <th>محصول</th>
                <th>قیمت</th>
                <th>منبع</th>
              </tr>
            </thead>
            <tbody>
              {data.preview.map((p, i) => (
                <tr key={p.id} data-source={p.source} data-product={p.id}>
                  <td className="tnum">{toFaDigits(i + 1)}</td>
                  <td>
                    <Link href={p.href}>{p.name}</Link>
                  </td>
                  <td className="tnum">{formatToman(p.priceToman)}</td>
                  <td>{SOURCE[p.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Container>
  );
}
