'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, type FormEvent } from 'react';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Button } from '@/ui';
import a from '../admin-forms.module.css';
import {
  collectionFormAction,
  packFormAction,
  type CollectionFormState,
  type PackFormState,
} from './actions';

export type Option = { value: string; label: string };
export type PackDraft = {
  id: number | null;
  collectionId: string;
  variantKey: string;
  variantTitle: string;
  title: string;
  description: string;
  discountKind: string;
  discountValue: string;
  active: boolean;
  allowLoss: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: string;
  steps: Array<{ label: string; product: string }>;
};
export type CollectionDraft = {
  id: number | null;
  slug: string;
  title: string;
  variantLabel: string;
  active: boolean;
  sortOrder: string;
};

/** Submitted by hand: a form `action` would reset every field after «پیش‌نمایش» or an error (React 19). */
function submitWith(action: (d: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  };
}

export function PackForm({
  draft,
  collections,
  products,
  maxSteps,
}: {
  draft: PackDraft;
  collections: Option[];
  products: Option[];
  maxSteps: number;
}) {
  const [state, action, pending] = useActionState<PackFormState, FormData>(packFormAction, {});
  const router = useRouter();
  useEffect(() => {
    if (state.savedId) router.refresh();
  }, [state, router]);
  const steps = Array.from({ length: maxSteps }, (_, i) => draft.steps[i] ?? { label: '', product: '' });
  return (
    <form onSubmit={submitWith(action)} className={a.form} aria-labelledby="pack-form-title">
      <h2 id="pack-form-title" className={a.formTitle}>
        {draft.id ? `ویرایش پک #${toFaDigits(draft.id)}` : 'پک جدید'}
      </h2>
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      <div className={a.grid}>
        <label className={a.field}>
          <span>مجموعه</span>
          <select name="collectionId" defaultValue={draft.collectionId} required>
            {collections.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={a.field}>
          <span>عنوان پک</span>
          <input
            name="title"
            defaultValue={draft.title}
            maxLength={100}
            required
            placeholder="روتین کامل پوست چرب"
          />
        </label>
        <label className={a.field}>
          <span>نام گونه</span>
          <input
            name="variantTitle"
            defaultValue={draft.variantTitle}
            maxLength={40}
            required
            placeholder="پوست چرب"
          />
        </label>
        <label className={a.field}>
          <span>نشانی گونه (انگلیسی)</span>
          <input
            name="variantKey"
            defaultValue={draft.variantKey}
            maxLength={40}
            required
            dir="ltr"
            placeholder="oily"
          />
        </label>
        <label className={a.field}>
          <span>نوع تخفیف پک</span>
          <select name="discountKind" defaultValue={draft.discountKind}>
            <option value="percent">درصد از جمع محصولات</option>
            <option value="fixed_price">قیمت ثابت پک (تومان)</option>
          </select>
        </label>
        <label className={a.field}>
          <span>مقدار (درصد یا تومان؛ ۰ = بدون تخفیف، قیمت پک = جمع محصولات)</span>
          <input
            name="discountValue"
            defaultValue={draft.discountValue}
            inputMode="numeric"
            required
            dir="ltr"
          />
        </label>
        <label className={a.field}>
          <span>شروع (اختیاری)</span>
          <input name="startsAt" type="datetime-local" defaultValue={draft.startsAt} dir="ltr" />
        </label>
        <label className={a.field}>
          <span>پایان (اختیاری)</span>
          <input name="endsAt" type="datetime-local" defaultValue={draft.endsAt} dir="ltr" />
        </label>
        <label className={a.field}>
          <span>ترتیب نمایش</span>
          <input name="sortOrder" defaultValue={draft.sortOrder} inputMode="numeric" dir="ltr" />
        </label>
        <label className={a.check}>
          <input type="checkbox" name="active" defaultChecked={draft.active} />
          <span>فعال</span>
        </label>
        <label className={`${a.check} ${a.danger}`}>
          <input type="checkbox" name="allowLoss" defaultChecked={draft.allowLoss} />
          <span>اجازه‌ی فروش با زیان (زیر قیمت خرید)</span>
        </label>
      </div>
      <label className={a.field}>
        <span>توضیح (اختیاری)</span>
        <input name="description" defaultValue={draft.description} maxLength={600} />
      </label>

      <fieldset className={a.steps}>
        <legend>مراحل (به ترتیب مصرف؛ محصول خالی = «به‌زودی»)</legend>
        <datalist id="pack-products">
          {products.map((o) => (
            <option key={o.value} value={`${o.value} — ${o.label}`} />
          ))}
        </datalist>
        {steps.map((st, i) => (
          <div key={i} className={a.stepRow}>
            <span className={a.stepNo}>{toFaDigits(i + 1)}</span>
            <input
              name={`step${i}Label`}
              defaultValue={st.label}
              maxLength={40}
              placeholder="نام مرحله (مثلاً پاک‌کننده)"
              aria-label={`نام مرحله‌ی ${i + 1}`}
            />
            <input
              name={`step${i}Product`}
              defaultValue={st.product}
              list="pack-products"
              autoComplete="off"
              placeholder="محصول: نام یا کد را بنویسید"
              aria-label={`محصول مرحله‌ی ${i + 1}`}
            />
          </div>
        ))}
      </fieldset>

      {state.message && <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>}
      {state.preview && (
        <div className={a.preview} data-preview>
          <table>
            <thead>
              <tr>
                <th>مرحله</th>
                <th>محصول</th>
                <th>قیمت فعلی</th>
              </tr>
            </thead>
            <tbody>
              {state.preview.steps.map((x, i) => (
                <tr key={i}>
                  <td>{x.label}</td>
                  <td>{x.name ?? 'به‌زودی'}</td>
                  <td className="tnum">{x.price !== null ? formatToman(x.price) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <b>
            جمع محصولات: <span className="tnum">{formatToman(state.preview.total)}</span> تومان · قیمت پک:{' '}
            <span className="tnum">
              {state.preview.final !== null ? formatToman(state.preview.final) : '—'}
            </span>{' '}
            تومان · صرفه‌جویی: {toFaDigits(state.preview.saving)}٪
          </b>
          {state.preview.atLoss && (
            <span className={a.lossNote} data-at-loss>
              ⚠ قیمت این پک زیر قیمت خرید محصولاتش است (فروش با زیان). فقط با تیک «اجازه‌ی فروش با زیان» ذخیره
              می‌شود.
            </span>
          )}
          {state.preview.unavailableNow && (
            <span className={a.lossNote}>
              یکی از محصولات الان ناموجود است؛ پک تا موجود شدنش «فعلاً در دسترس نیست».
            </span>
          )}
        </div>
      )}
      <div className={a.actions}>
        <Button type="submit" name="intent" value="preview" variant="outline" disabled={pending}>
          پیش‌نمایش
        </Button>
        <Button type="submit" name="intent" value="save" icon="check" disabled={pending}>
          {draft.id ? 'ذخیره‌ی تغییرات' : 'ساخت پک'}
        </Button>
      </div>
    </form>
  );
}

export function CollectionForm({ draft }: { draft: CollectionDraft }) {
  const [state, action, pending] = useActionState<CollectionFormState, FormData>(collectionFormAction, {});
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form onSubmit={submitWith(action)} className={a.form} aria-labelledby="collection-form-title">
      <h2 id="collection-form-title" className={a.formTitle}>
        {draft.id ? `ویرایش مجموعه #${toFaDigits(draft.id)}` : 'مجموعه‌ی جدید'}
      </h2>
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      <div className={a.grid}>
        <label className={a.field}>
          <span>عنوان</span>
          <input name="title" defaultValue={draft.title} maxLength={80} required placeholder="روتین پوستی" />
        </label>
        <label className={a.field}>
          <span>نشانی (انگلیسی)</span>
          <input
            name="slug"
            defaultValue={draft.slug}
            maxLength={60}
            required
            dir="ltr"
            placeholder="skin-routine"
          />
        </label>
        <label className={a.field}>
          <span>نام گونه‌ها</span>
          <input
            name="variantLabel"
            defaultValue={draft.variantLabel}
            maxLength={40}
            required
            placeholder="نوع پوست"
          />
        </label>
        <label className={a.field}>
          <span>ترتیب نمایش</span>
          <input name="sortOrder" defaultValue={draft.sortOrder} inputMode="numeric" dir="ltr" />
        </label>
        <label className={a.check}>
          <input type="checkbox" name="active" defaultChecked={draft.active} />
          <span>فعال</span>
        </label>
      </div>
      {state.message && <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>}
      <div className={a.actions}>
        <Button type="submit" icon="check" disabled={pending}>
          {draft.id ? 'ذخیره‌ی تغییرات' : 'ساخت مجموعه'}
        </Button>
      </div>
    </form>
  );
}
