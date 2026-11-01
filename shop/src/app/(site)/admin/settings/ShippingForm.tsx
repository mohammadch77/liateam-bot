import type { Range } from '@/lib/shipping-rules';
import type { ShippingView } from '@/server/services/shipping-admin.service';
import { Alert, Button } from '@/ui';
import a from '../admin-forms.module.css';
import { saveShippingAction } from './actions';
import { SelectAll } from './SelectAll';
import t from './settings.module.css';

const FORM_ID = 'shipping-form';

function Days({ prefix, range, label }: { prefix: string; range: Range | null; label: string }) {
  return (
    <span className={t.pair}>
      <input
        className={`${t.num} ${t.short}`}
        name={`${prefix}.min`}
        defaultValue={range?.min ?? ''}
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        aria-label={`حداقل روز کاری: ${label}`}
        placeholder="از"
      />
      تا
      <input
        className={`${t.num} ${t.short}`}
        name={`${prefix}.max`}
        defaultValue={range?.max ?? ''}
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        aria-label={`حداکثر روز کاری: ${label}`}
        placeholder="تا"
      />
      روز
    </span>
  );
}

/**
 * Method «پست»: label and on/off, the delivery range (working days) for every province, and a range of its own per province
 * — edited row by row or in bulk for the ticked ones. A blank pair means no range of its own. Checkout shows the range plus
 * the «روزهای اضافه‌ی تحویل» setting. The price of shipping is Liateam's and is not edited here.
 */
export function ShippingForm({ view }: { view: ShippingView }) {
  return (
    <form action={saveShippingAction} id={FORM_ID} className={a.form} data-shipping-form>
      {/* Enter in a field saves the form (the first submit button), never the bulk button below */}
      <button
        type="submit"
        name="intent"
        value="save"
        className={t.visuallyHidden}
        tabIndex={-1}
        aria-hidden="true"
      >
        ذخیره
      </button>
      <h2 className={a.formTitle}>روش ارسال «پست»: برچسب و زمان تحویل</h2>
      <div className={a.grid}>
        <label className={a.field}>
          برچسب روش ارسال
          <input name="label" defaultValue={view.label} maxLength={80} required />
        </label>
        <label className={a.check}>
          <input type="checkbox" name="active" value="1" defaultChecked={view.active} />
          <span>فعال (نمایش زمان تحویل در تسویه)</span>
        </label>
      </div>

      <div className={t.row}>
        <span className={t.rowLabel}>بازه‌ی پیش‌فرض همه‌ی استان‌ها (روز کاری)</span>
        <Days prefix="fallback" range={view.fallback} label="پیش‌فرض" />
        <p className={a.hint}>
          برای استانی که بازه‌ی جدا ندارد. خالی = بدون بازه (تسویه می‌گوید زمان بعد از ثبت اعلام می‌شود).
        </p>
      </div>

      {view.provinces ? (
        <>
          <div className={t.bulk}>
            <span className={t.rowLabel}>ویرایش دسته‌ای</span>
            <div className={t.inline}>
              <Days prefix="bulk" range={null} label="دسته‌ای" />
              <Button type="submit" name="intent" value="bulk" variant="outline" size="sm" data-bulk-apply>
                اعمال روی استان‌های تیک‌خورده
              </Button>
            </div>
            <SelectAll formId={FORM_ID} name="sel" />
          </div>
          <div className={t.list} data-provinces>
            {view.provinces.map((p) => (
              <div key={p.id} className={t.prov} data-province={p.id}>
                <label className={t.provName}>
                  <input type="checkbox" name="sel" value={p.id} />
                  {p.name}
                </label>
                <Days prefix={`p.${p.id}`} range={p.range} label={p.name} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <Alert tone="warning">فهرست استان‌ها از لیاتیم دریافت نشد؛ فقط بازه‌ی پیش‌فرض قابل ویرایش است.</Alert>
      )}

      <div className={a.actions}>
        <Button type="submit" name="intent" value="save">
          ذخیره‌ی تنظیمات ارسال
        </Button>
      </div>
    </form>
  );
}
