import type { Metadata } from 'next';
import Link from 'next/link';
import { GROUPS, type SettingGroup } from '@/lib/settings/registry';
import { adminPath, adminSettingsPath } from '@/lib/urls';
import { requireRole } from '@/server/auth/guards';
import { commissionService, parseSimulator } from '@/server/services/commission.service';
import { PAYMENT_PROVIDERS } from '@/lib/payment/registry';
import { SMS_PROVIDERS } from '@/lib/sms/registry';
import { settingsService, type FieldView } from '@/server/services/settings.service';
import { shippingAdminService } from '@/server/services/shipping-admin.service';
import { siteSettingsService } from '@/server/services/site-settings.service';
import { Alert, Breadcrumb, Button } from '@/ui';
import s from '../../account/account.module.css';
import a from '../admin-forms.module.css';
import { saveGroupAction, setSecretAction, testPaymentAction, testSmsAction } from './actions';
import { CommissionPanel } from './CommissionPanel';
import t from './settings.module.css';
import { ShippingForm } from './ShippingForm';

export const metadata: Metadata = { title: 'تنظیمات', robots: { index: false } };

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short' });

function PlainField({ f }: { f: FieldView }) {
  const id = `f-${f.key}`;
  if (f.kind === 'boolean')
    return (
      <div className={t.row}>
        <label className={a.check}>
          <input
            type="checkbox"
            name={f.key}
            value="1"
            defaultChecked={f.value === true}
            data-setting={f.key}
          />
          <span>{f.label}</span>
        </label>
        {f.hint && <p className={a.hint}>{f.hint}</p>}
      </div>
    );
  if (f.kind === 'enum')
    return (
      <fieldset className={a.steps}>
        <legend>{f.label}</legend>
        {f.options?.map((o) => (
          <label key={o.value} className={t.radio}>
            <input
              type="radio"
              name={f.key}
              value={o.value}
              defaultChecked={f.value === o.value}
              data-setting={f.key}
            />
            <span>{o.label}</span>
          </label>
        ))}
        {f.hint && <p className={a.hint}>{f.hint}</p>}
      </fieldset>
    );
  if (f.kind === 'timerange') {
    const v = f.value as { from: string; to: string };
    return (
      <div className={t.row} role="group" aria-labelledby={`${id}-l`}>
        <span id={`${id}-l`} className={t.rowLabel}>
          {f.label}
        </span>
        <div className={t.inline}>
          <label htmlFor={`${id}-from`}>از</label>
          <input
            id={`${id}-from`}
            className={t.num}
            type="time"
            name={`${f.key}.from`}
            defaultValue={v.from}
            dir="ltr"
            required
          />
          <label htmlFor={`${id}-to`}>تا</label>
          <input
            id={`${id}-to`}
            className={t.num}
            type="time"
            name={`${f.key}.to`}
            defaultValue={v.to}
            dir="ltr"
            required
          />
        </div>
        {f.hint && <p className={a.hint}>{f.hint}</p>}
      </div>
    );
  }
  const isNumber = f.kind === 'integer';
  return (
    <div className={t.row}>
      <label htmlFor={id} className={t.rowLabel}>
        {f.label}
      </label>
      <div className={t.inline}>
        <input
          id={id}
          className={`${t.num} ${f.kind === 'url' ? t.wide : ''}`}
          name={f.key}
          defaultValue={String(f.value ?? '')}
          data-setting={f.key}
          dir="ltr"
          {...(isNumber
            ? { inputMode: 'numeric' as const, autoComplete: 'off' }
            : f.kind === 'url'
              ? { type: 'url', placeholder: 'https://shop.example.com' }
              : { type: 'text', autoComplete: 'off' })}
        />
        {f.unit && <span className={t.unit}>{f.unit}</span>}
      </div>
      {f.hint && <p className={a.hint}>{f.hint}</p>}
    </div>
  );
}

/** A secret: its state and mask only. The value is write-only; «تعویض» sends a new one in its own small form. */
function SecretField({ f, group, enabled }: { f: FieldView; group: SettingGroup; enabled: boolean }) {
  const id = `f-${f.key}`;
  return (
    <form action={setSecretAction} className={t.secret} data-secret={f.key} autoComplete="off">
      <input type="hidden" name="group" value={group} />
      <input type="hidden" name="key" value={f.key} />
      <span className={t.rowLabel}>{f.label}</span>
      <span className={`${t.state} ${f.secret?.configured ? t.on : ''}`} data-secret-state>
        {f.secret?.configured ? (
          <>
            ذخیره شده: <span className={t.mask}>{f.secret.mask}</span>
            {f.secret.updatedAt && ` · ${dateFa.format(f.secret.updatedAt)}`}
          </>
        ) : (
          'تنظیم نشده'
        )}
      </span>
      <div className={t.inline}>
        <input
          id={id}
          className={`${t.num} ${t.wide}`}
          type="password"
          name="value"
          autoComplete="new-password"
          spellCheck={false}
          dir="ltr"
          disabled={!enabled}
          aria-label={`مقدار جدید: ${f.label}`}
          placeholder={f.secret?.configured ? 'مقدار جدید' : 'مقدار'}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!enabled}>
          {f.secret?.configured ? 'تعویض' : 'ذخیره'}
        </Button>
      </div>
      <p className={a.hint}>فقط نوشتنی است: مقدار کامل هیچ‌جا دوباره نمایش داده نمی‌شود.</p>
    </form>
  );
}

/**
 * The settings screen of the panel: sections for the general switches, the order flow and automatic placing, shipping, and
 * commissions, SMS and payment (all live in the order flow). Every field comes from the registry (src/lib/settings/registry.ts);
 * every save is audited and takes effect at once. Admins only.
 */
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole('admin', '/admin/settings');
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const group = (GROUPS.find((g) => g.id === one('section'))?.id ?? 'general') as SettingGroup;
  const meta = GROUPS.find((g) => g.id === group)!;
  const { fields, secretsEnabled } = await settingsService.group(group);
  const plain = fields.filter((f) => !f.secret);
  const secrets = fields.filter((f) => f.secret);
  const isCommission = group === 'commission';
  const rules = isCommission ? await commissionService.rules() : [];
  const editId = /^\d+$/.test(one('edit')) ? Number(one('edit')) : null;
  const editing = isCommission && editId ? await commissionService.rule(editId) : null;
  const sim = isCommission ? parseSimulator({ get: (k: string) => sp[k] }) : null;
  const simResult = sim ? await commissionService.simulate(sim) : null;
  const shipping = group === 'shipping' ? await shippingAdminService.view().catch(() => null) : null;
  const forced = group === 'general' && siteSettingsService.indexingForcedByEnvironment();

  return (
    <div className={s.page}>
      <Breadcrumb
        items={[{ label: 'خانه', href: '/' }, { label: 'مدیریت', href: adminPath() }, { label: 'تنظیمات' }]}
      />
      <nav aria-label="بخش‌های تنظیمات" className={t.tabs} data-settings-tabs>
        {GROUPS.map((g) => (
          <Link
            key={g.id}
            href={adminSettingsPath(g.id)}
            className={t.tab}
            aria-current={g.id === group ? 'page' : undefined}
            data-section={g.id}
          >
            {g.label}
          </Link>
        ))}
      </nav>

      <section
        className={s.card}
        aria-labelledby="settings-title"
        style={{ maxWidth: 'none' }}
        data-settings-section={group}
      >
        <h1 id="settings-title" className={s.title}>
          تنظیمات: {meta.label}
        </h1>
        {one('done') && <Alert tone="success">تنظیمات ذخیره شد و همین حالا اعمال شد.</Alert>}
        {one('shipped') && <Alert tone="success">تنظیمات ارسال ذخیره شد.</Alert>}
        {one('secret') && <Alert tone="success">مقدار جدید به‌صورت رمزنگاری‌شده ذخیره شد.</Alert>}
        {one('error') && <Alert tone="danger">{one('error')}</Alert>}
        {one('test') && (
          <div data-test-result={one('test')}>
            <Alert tone={one('test') === 'ok' ? 'success' : 'danger'}>{one('msg')}</Alert>
          </div>
        )}

        {plain.length > 0 && (
          <form action={saveGroupAction} className={a.form} data-settings-form={group}>
            <input type="hidden" name="group" value={group} />
            <div className={t.fields}>
              {plain.map((f) => (
                <PlainField key={f.key} f={f} />
              ))}
            </div>
            {forced && (
              <Alert tone="warning">
                این نسخه‌ی آزمایشی (staging) است: صرف‌نظر از گزینه‌ی ایندکس، همیشه از ایندکس شدن جلوگیری
                می‌شود.
              </Alert>
            )}
            <div className={a.actions}>
              <Button type="submit">ذخیره</Button>
            </div>
          </form>
        )}

        {secrets.length > 0 && (
          <>
            {!secretsEnabled && (
              <Alert tone="warning">
                ذخیره‌ی کلیدها غیرفعال است: متغیر SETTINGS_ENCRYPTION_KEY در فایل .env سرور تنظیم نشده است (۳۲
                بایت، ۶۴ نویسه‌ی hex). بعد از تنظیم و راه‌اندازی دوباره‌ی سرویس، این بخش فعال می‌شود.
              </Alert>
            )}
            <div className={t.fields}>
              {secrets.map((f) => (
                <SecretField key={f.key} f={f} group={group} enabled={secretsEnabled} />
              ))}
            </div>
          </>
        )}

        {group === 'payment' && (
          <form action={testPaymentAction} className={t.secret} data-payment-test>
            <span className={t.rowLabel}>تست اتصال</span>
            <p className={a.hint}>
              فقط تنظیمات ذخیره‌شده را بدون هیچ تراکنشی بررسی می‌کند. وضعیت درگاه‌ها:{' '}
              {Object.values(PAYMENT_PROVIDERS)
                .map((p) => `${p.label}: ${p.verified ? 'تأییدشده' : 'تأییدنشده'}`)
                .join('، ')}
            </p>
            <div className={a.actions}>
              <Button type="submit" variant="outline">
                تست اتصال
              </Button>
            </div>
          </form>
        )}
        {group === 'sms' && (
          <form action={testSmsAction} className={t.secret} data-sms-test>
            <span className={t.rowLabel}>ارسال آزمایشی</span>
            <p className={a.hint}>
              یک پیامک آزمایشی فقط به شماره‌ی خود شما فرستاده می‌شود (حداکثر ۳ بار در ۱۰ دقیقه). وضعیت
              سرویس‌ها:{' '}
              {Object.values(SMS_PROVIDERS)
                .map((p) => `${p.label}: ${p.verified ? 'تأییدشده' : 'تأییدنشده'}`)
                .join('، ')}
            </p>
            <div className={a.actions}>
              <Button type="submit" variant="outline">
                ارسال آزمایشی
              </Button>
            </div>
          </form>
        )}
        {isCommission && <CommissionPanel rules={rules} editing={editing} sim={sim} simResult={simResult} />}
        {group === 'shipping' &&
          (shipping ? (
            <ShippingForm view={shipping} />
          ) : (
            <Alert tone="warning">
              فهرست استان‌ها و روش ارسال «پست» در دسترس نیست (اتصال به لیاتیم برقرار نشد یا مایگریشن ۰۱۷ اجرا
              نشده). کمی بعد دوباره باز کنید.
            </Alert>
          ))}
      </section>
    </div>
  );
}
