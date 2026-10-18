'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert } from '@/ui/feedback/Feedback';
import { Button } from '@/ui/button/Button';
import { Checkbox } from '@/ui/field/Checkbox';
import { Select } from '@/ui/field/Select';
import { TextField } from '@/ui/field/TextField';
import f from '@/ui/field/Field.module.css';
import { applyAffiliateAction, type AffiliateState } from './actions';
import s from './affiliate.module.css';

type Option = { value: string; label: string };

/**
 * «درخواست همکاری در فروش». A plain form posted to a Server Action; the browser checks the obvious things and
 * the server validates and cleans everything again (the only check that counts). The phone comes from the
 * signed-in account and is only shown here.
 */
export function AffiliateForm({
  fullName,
  phone,
  source,
  provinces,
  channels,
  followers,
  descriptionMax,
}: {
  fullName: string;
  phone: string;
  source: string;
  provinces: readonly string[];
  channels: readonly Option[];
  followers: readonly Option[];
  descriptionMax: number;
}) {
  const [state, action] = useActionState<AffiliateState, FormData>(applyAffiliateAction, null);
  const [length, setLength] = useState(0);

  if (state?.ok) {
    return (
      <div className={s.done} role="status">
        <Alert tone="success">
          درخواستت ثبت شد و در حال بررسی است. نتیجه را به شماره‌ی {phone} خبر می‌دهیم.
        </Alert>
      </div>
    );
  }

  return (
    <form action={action} className={s.form} aria-labelledby="affiliate-form-title">
      <h2 id="affiliate-form-title" className={s.formTitle}>
        فرم درخواست همکاری
      </h2>
      {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="source" value={source} />
      <div className={s.grid}>
        <TextField
          name="fullName"
          label="نام و نام خانوادگی"
          defaultValue={fullName}
          autoComplete="name"
          required
          minLength={3}
          maxLength={80}
        />
        <TextField label="شماره موبایل" value={phone} readOnly ltr hint="شماره‌ی تأییدشده‌ی حساب شما" />
        <Select
          name="province"
          label="استان"
          required
          defaultValue=""
          options={[
            { value: '', label: 'انتخاب کنید', disabled: true },
            ...provinces.map((p) => ({ value: p, label: p })),
          ]}
        />
        <TextField
          name="city"
          label="شهر"
          required
          minLength={2}
          maxLength={60}
          autoComplete="address-level2"
        />
        <Select
          name="channelType"
          label="کانال اصلی فروش"
          required
          defaultValue=""
          options={[{ value: '', label: 'انتخاب کنید', disabled: true }, ...channels]}
        />
        <TextField
          name="channelUrl"
          label="نشانی اینستاگرام یا کانال فروش"
          placeholder="@yourpage یا instagram.com/yourpage"
          required
          maxLength={200}
          ltr
          hint="برای فروشگاه حضوری: صفحه یا وب‌سایت فروشگاه"
        />
        <Select
          name="followers"
          label="تعداد تقریبی دنبال‌کننده یا مشتری"
          defaultValue=""
          options={[{ value: '', label: 'اختیاری' }, ...followers]}
        />
      </div>
      <div className={f.field}>
        <label htmlFor="affiliate-description" className={f.label}>
          توضیح کوتاه درباره‌ی نحوه‌ی فروش
        </label>
        <textarea
          id="affiliate-description"
          name="description"
          required
          minLength={20}
          maxLength={descriptionMax}
          rows={5}
          className={`${f.control} ${s.textarea}`}
          placeholder="مثلاً: پیج آرایشی با مخاطب خانم‌های ۲۰ تا ۳۵ سال؛ معرفی محصول با ویدیو و ارسال برای مشتری…"
          onChange={(e) => setLength(e.currentTarget.value.length)}
          aria-describedby="affiliate-description-count"
        />
        <span id="affiliate-description-count" className={f.hint}>
          {length.toLocaleString('fa-IR')} از {descriptionMax.toLocaleString('fa-IR')} حرف
        </span>
      </div>
      <Checkbox name="terms" value="1" required>
        با شرایط همکاری در فروش موافقم و اطلاعات بالا درست است.
      </Checkbox>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div className={s.submit}>
      <Button type="submit" loading={pending} icon="check">
        ثبت درخواست
      </Button>
    </div>
  );
}
