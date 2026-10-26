'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useState } from 'react';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { Alert, Button } from '@/ui';
import a from '../admin-forms.module.css';
import { discountFormAction, type DiscountFormState } from './actions';

export type Option = { value: string; label: string };
export type DiscountDraft = {
  id: number | null;
  scope: string;
  target: string;
  kind: string;
  value: string;
  startsAt: string;
  endsAt: string;
  label: string;
  campaign: string;
  active: boolean;
  allowLoss: boolean;
};

const SCOPES: Option[] = [
  { value: 'product', label: 'یک محصول' },
  { value: 'category', label: 'یک دسته (با همه‌ی زیردسته‌ها)' },
  { value: 'brand', label: 'یک برند' },
  { value: 'all', label: 'کل فروشگاه' },
];

/**
 * New / edit discount. The target is picked by typing (a datalist of products, categories or brands, «کد — نام»);
 * «پیش‌نمایش» shows how many products it covers and a few example prices (Liateam's and ours) before saving.
 */
export function DiscountForm({
  draft,
  products,
  categories,
  brands,
  campaigns,
}: {
  draft: DiscountDraft;
  products: Option[];
  categories: Option[];
  brands: Option[];
  campaigns: Option[];
}) {
  const [state, action, pending] = useActionState<DiscountFormState, FormData>(discountFormAction, {});
  const router = useRouter();
  // saved: the list beside the form is server-rendered, so read it again
  useEffect(() => {
    if (state.savedId) router.refresh();
  }, [state, router]);
  const [scope, setScope] = useState(draft.scope);
  const [kind, setKind] = useState(draft.kind);
  const list =
    scope === 'product' ? products : scope === 'category' ? categories : scope === 'brand' ? brands : [];

  return (
    <form
      // submitted by hand: a form `action` resets every field afterwards (React 19), which would empty the form
      // after «پیش‌نمایش» or an error; the pressed button (intent) travels with the data
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(data));
      }}
      className={a.form}
      aria-labelledby="discount-form-title"
    >
      <h2 id="discount-form-title" className={a.formTitle}>
        {draft.id ? `ویرایش تخفیف #${toFaDigits(draft.id)}` : 'تخفیف جدید'}
      </h2>
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      <div className={a.grid}>
        <label className={a.field}>
          <span>دامنه</span>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {scope !== 'all' && (
          <label className={a.field}>
            <span>
              {scope === 'product' ? 'محصول' : scope === 'category' ? 'دسته' : 'برند'} (جست‌وجو کنید)
            </span>
            <input
              name="target"
              list="discount-targets"
              defaultValue={draft.target}
              key={scope}
              autoComplete="off"
              placeholder="نام یا کد را بنویسید"
              required
            />
            <datalist id="discount-targets">
              {list.map((o) => (
                <option key={o.value} value={`${o.value} — ${o.label}`} />
              ))}
            </datalist>
          </label>
        )}
        <label className={a.field}>
          <span>نوع</span>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="percent">درصدی</option>
            <option value="amount">مبلغ ثابت (تومان)</option>
          </select>
        </label>
        <label className={a.field}>
          <span>{kind === 'percent' ? 'درصد (۱ تا ۹۰)' : 'مبلغ (تومان)'}</span>
          <input name="value" inputMode="numeric" defaultValue={draft.value} required dir="ltr" />
        </label>
        <label className={a.field}>
          <span>شروع (خالی = همین حالا)</span>
          <input name="startsAt" type="datetime-local" defaultValue={draft.startsAt} dir="ltr" />
        </label>
        <label className={a.field}>
          <span>پایان (خالی = بدون پایان)</span>
          <input name="endsAt" type="datetime-local" defaultValue={draft.endsAt} dir="ltr" />
        </label>
        <label className={a.field}>
          <span>برچسب (اختیاری)</span>
          <input name="label" maxLength={60} defaultValue={draft.label} placeholder="مثلاً جشنواره پاییزه" />
        </label>
        <label className={a.field}>
          <span>کمپین (اختیاری)</span>
          <select name="campaign" defaultValue={draft.campaign}>
            <option value="">بدون کمپین</option>
            {campaigns.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
      <p className={a.hint}>
        زمان‌ها به وقت تهران است. بدون تیک «اجازه‌ی فروش با زیان»، تخفیفی که قیمت را به قیمت خرید برساند ذخیره
        نمی‌شود؛ با آن تیک، تصمیم با شماست و فقط سقف کل تخفیف اعمال می‌شود. از چند تخفیفِ هم‌زمان روی یک
        محصول، فقط بزرگ‌ترین اعمال می‌شود و کل تخفیف هیچ‌وقت از سقف مجاز بیشتر نمی‌شود.
      </p>

      {state.message && <Alert tone={state.ok ? 'success' : 'danger'}>{state.message}</Alert>}
      {state.preview && (
        <div className={a.preview} data-preview>
          <b>پیش‌نمایش اثر: {toFaDigits(state.preview.affected)} محصول</b>
          {state.preview.maxWithoutLoss !== null && (
            <span className={a.hint} data-partner-note>
              مشتری همین حالا تخفیف پایه‌ی همکاری (حدود{' '}
              {toFaDigits(Math.round(state.preview.basePercent ?? 0))}٪) را می‌گیرد. تخفیفی که قیمت را از قیمت
              خرید پایین‌تر ببرد زیر قیمت خرید است و فقط با تیک «اجازه‌ی فروش با زیان» اعمال می‌شود؛ حداکثر
              تخفیف بدون آن تیک: {toFaDigits(Math.round(state.preview.maxWithoutLoss))}٪.
            </span>
          )}
          {state.preview.atLoss > 0 && (
            <span className={a.lossNote} data-at-loss>
              ⚠ این تخفیف {toFaDigits(state.preview.atLoss)} محصول را زیر قیمت خرید (با زیان) می‌فروشد. فقط با
              تیک «اجازه‌ی فروش با زیان» ذخیره می‌شود.
            </span>
          )}
          {state.preview.samples.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>محصول</th>
                  <th>قیمت لیاتیم</th>
                  <th>قیمت با تخفیف</th>
                </tr>
              </thead>
              <tbody>
                {state.preview.samples.map((x) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td className="tnum">{formatToman(x.price)}</td>
                    <td className="tnum">{x.final ? formatToman(x.final) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className={a.actions}>
        <Button type="submit" name="intent" value="preview" variant="outline" disabled={pending}>
          پیش‌نمایش اثر
        </Button>
        <Button type="submit" name="intent" value="save" icon="check" disabled={pending}>
          {draft.id ? 'ذخیره‌ی تغییرات' : 'ساخت تخفیف'}
        </Button>
      </div>
    </form>
  );
}
