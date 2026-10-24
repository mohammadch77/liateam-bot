import type { Metadata } from 'next';
import { requireRole } from '@/server/auth/guards';
import { siteSettingsService } from '@/server/services/site-settings.service';
import { Alert, Breadcrumb, Button, Container } from '@/ui';
import s from '../../account/account.module.css';
import a from '../admin-forms.module.css';
import { saveSettingsAction } from './actions';

export const metadata: Metadata = { title: 'تنظیمات', robots: { index: false } };

/**
 * Site-wide settings (like WordPress's «Settings → Reading»): how Liateam's discount reaches the customer, and whether
 * search engines may index the site. Admins only; every change is audited.
 */
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/settings');
  const sp = await searchParams;
  const settings = await siteSettingsService.get();
  const forced = siteSettingsService.indexingForcedByEnvironment();

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: '/admin' }, { label: 'تنظیمات' }]}
      />
      <section className={s.card} aria-labelledby="settings-title" style={{ maxWidth: 'none' }}>
        <h1 id="settings-title" className={s.title}>
          تنظیمات سایت
        </h1>
        {sp.done && <Alert tone="success">تنظیمات ذخیره شد.</Alert>}
        {typeof sp.error === 'string' && sp.error && <Alert tone="danger">{sp.error}</Alert>}

        <form action={saveSettingsAction} className={a.form} data-settings-form>
          <fieldset className={a.steps}>
            <legend>روش اعمال تخفیف لیاتیم</legend>
            <label className={a.check}>
              <input
                type="radio"
                name="discountMode"
                value="liateam"
                defaultChecked={settings.discountMode === 'liateam'}
              />
              <span>
                همان تخفیف لیاتیم (پیش‌فرض) — هر تخفیفی که خود سایت لیاتیم روی محصول نشان می‌دهد، با همان درصد
                به مشتری می‌رسد؛ محصولی که در لیاتیم تخفیف ندارد با قیمت عادی لیاتیم فروخته می‌شود.
              </span>
            </label>
            <label className={a.check}>
              <input
                type="radio"
                name="discountMode"
                value="excess"
                defaultChecked={settings.discountMode === 'excess'}
              />
              <span>
                فقط مازاد بر سود پایه — از تخفیفی که لیاتیم به حساب ما می‌دهد، فقط بخشِ بیشتر از سود پایه‌ی ما
                به مشتری می‌رسد.
              </span>
            </label>
            <p className={a.hint}>
              در هر دو حالت تخفیف‌های دستی شما (محصول، دسته، برند یا همه) روی آن اضافه می‌شوند، مجموع تخفیف از
              سقف تعیین‌شده بیشتر نمی‌شود و قیمت هیچ‌وقت از کف مجاز پایین‌تر نمی‌رود.
            </p>
          </fieldset>

          <fieldset className={a.steps}>
            <legend>موتورهای جستجو</legend>
            <label className={a.check}>
              <input
                type="checkbox"
                name="blockIndexing"
                value="1"
                defaultChecked={settings.blockIndexing}
                data-block-indexing
              />
              <span>جلوگیری از ایندکس شدن توسط موتورهای جستجو</span>
            </label>
            <p className={a.hint}>
              وقتی روشن است: برچسب noindex در همه‌ی صفحه‌ها، robots.txt با «Disallow: /»، نقشه‌ی سایت
              (sitemap.xml) خاموش و هدر X-Robots-Tag. وقتی سایت آماده‌ی دیده شدن در گوگل شد خاموشش کنید.
            </p>
            {forced && (
              <Alert tone="warning">
                این نسخه‌ی آزمایشی (staging) است: صرف‌نظر از این گزینه، همیشه از ایندکس شدن جلوگیری می‌شود تا
                نسخه‌ی آزمایشی هرگز در نتایج جستجو نیاید. این گزینه فقط روی سایت اصلی اثر دارد.
              </Alert>
            )}
          </fieldset>

          <div className={a.actions}>
            <Button type="submit">ذخیره‌ی تنظیمات</Button>
          </div>
        </form>
      </section>
    </Container>
  );
}
