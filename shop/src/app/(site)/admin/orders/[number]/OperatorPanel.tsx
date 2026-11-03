'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OperatorAction } from '@/lib/orders/operator';
import { Alert, Button, TextField } from '@/ui';
import { ConfirmDialog } from '../../../account/_ui/ConfirmDialog';
import { operatorAction } from './actions';

type Spec = {
  label: string;
  title: string;
  body: string;
  confirm: string;
  /** the one text the action asks for (absent: just confirm) */
  field?: { label: string; required: boolean; multiline?: boolean; ltr?: boolean; max: number };
  primary?: boolean;
};

const SPECS: Record<OperatorAction, Spec> = {
  place: {
    label: 'ثبت در لیاتیم',
    title: 'ثبت سفارش در لیاتیم',
    body: 'سفارش همین حالا در صف ثبت ربات قرار می‌گیرد (همان مسیر ثبت خودکار).',
    confirm: 'ثبت کن',
    primary: true,
  },
  recheck: {
    label: 'درخواست بررسی دوباره',
    title: 'بررسی دوبارهٔ قیمت و موجودی',
    body: 'ربات سبد را دوباره با لیاتیم می‌سنجد؛ اگر در محدودهٔ مجاز بود سفارش ثبت می‌شود.',
    confirm: 'درخواست بده',
  },
  continue_review: {
    label: 'ادامه با قیمت جدید',
    title: 'ادامه با قیمت جدید',
    body: 'سفارش با جمع فعلی لیاتیم ثبت می‌شود و اگر ارزان‌تر شده، تفاوت به کیف پول مشتری برمی‌گردد.',
    confirm: 'ادامه بده',
    primary: true,
  },
  cancel: {
    label: 'لغو و بازگشت کامل به کیف پول',
    title: 'لغو سفارش',
    body: 'سفارش لغو می‌شود، کل مبلغ پرداخت‌شده به کیف پول مشتری برمی‌گردد و پورسانت‌های در انتظارش لغو می‌شود. اگر سفارش در لیاتیم ثبت شده، مطمئن شوید آنجا پرداخت نشده است.',
    confirm: 'لغو کن',
    field: { label: 'دلیل (اختیاری)', required: false, max: 200 },
  },
  approve_cancel: {
    label: 'تأیید درخواست لغو',
    title: 'تأیید درخواست لغوِ مشتری',
    body: 'مطمئن شوید سفارش در لیاتیم پرداخت نشده یا لغو شده است. سفارش لغو و کل مبلغ به کیف پول مشتری برگردانده می‌شود.',
    confirm: 'تأیید و بازگشت وجه',
    primary: true,
  },
  reject_cancel: {
    label: 'رد درخواست لغو',
    title: 'رد درخواست لغو',
    body: 'سفارش ادامه پیدا می‌کند و مشتری مطلع می‌شود.',
    confirm: 'رد کن',
    field: { label: 'دلیل رد (مثلاً: پرداخت در لیاتیم انجام شده)', required: true, max: 200 },
  },
  mark_paid: {
    label: 'پرداخت شد (لیاتیم)',
    title: 'ثبت پرداخت نهایی در لیاتیم',
    body: 'فقط وقتی بزنید که سفارش را در لیاتیم واقعاً پرداخت کرده‌اید. سفارش به مرحلهٔ ارسال می‌رود و دیگر قابل لغو نیست.',
    confirm: 'پرداخت شد',
    field: { label: 'مرجع پرداخت (شماره پیگیری یا توضیح)', required: true, max: 100 },
    primary: true,
  },
  ship: {
    label: 'ارسال شد (کد رهگیری)',
    title: 'ثبت ارسال',
    body: 'سفارش «ارسال‌شده» می‌شود و پیامک ارسال با کد رهگیری برای مشتری می‌رود. پورسانت‌ها طبق زمان‌بندی آزاد می‌شوند.',
    confirm: 'ثبت ارسال',
    field: { label: 'کد رهگیری پستی', required: true, ltr: true, max: 40 },
    primary: true,
  },
  manual_return: {
    label: 'بازگشت دستی',
    title: 'ثبت بازگشت دستی',
    body: 'فقط یادداشت و رویداد ثبت می‌شود؛ هیچ مبلغی خودکار جابه‌جا نمی‌شود و حل موضوع با خود شماست.',
    confirm: 'یادداشت کن',
    field: { label: 'توضیح', required: true, multiline: true, max: 500 },
  },
  note: {
    label: 'یادداشت داخلی',
    title: 'یادداشت داخلی',
    body: 'فقط ادمین می‌بیند؛ هرگز برای مشتری نمایش داده نمی‌شود.',
    confirm: 'ثبت یادداشت',
    field: { label: 'متن یادداشت', required: true, multiline: true, max: 1000 },
  },
};

const ORDER: OperatorAction[] = [
  'place',
  'continue_review',
  'recheck',
  'approve_cancel',
  'reject_cancel',
  'mark_paid',
  'ship',
  'cancel',
  'manual_return',
  'note',
];

/** The operator's buttons for this order. Each opens a confirmation (with the text it needs); the server decides again. */
export function OperatorPanel({
  number,
  actions,
  reviewNote,
}: {
  number: string;
  actions: OperatorAction[];
  reviewNote?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OperatorAction | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const spec = open ? SPECS[open] : null;

  const run = async () => {
    if (!open || !spec) return;
    if (spec.field?.required && value.trim() === '') {
      setResult({ ok: false, text: 'این بخش را پر کنید.' });
      setOpen(null);
      return;
    }
    setBusy(true);
    try {
      const r = await operatorAction(number, open, value);
      setResult(r.ok ? { ok: true, text: r.data.message } : { ok: false, text: r.error });
    } catch {
      setResult({ ok: false, text: 'اقدام انجام نشد. دوباره تلاش کنید.' });
    } finally {
      setBusy(false);
      setOpen(null);
      setValue('');
      router.refresh();
    }
  };

  return (
    <div data-operator-panel>
      {result && (
        <Alert tone={result.ok ? 'success' : 'danger'}>
          <span data-operator-result={result.ok ? 'ok' : 'error'}>{result.text}</span>
        </Alert>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ORDER.filter((a) => actions.includes(a)).map((a) => (
          <Button
            key={a}
            variant={SPECS[a].primary ? 'primary' : 'outline'}
            onClick={() => {
              setValue('');
              setResult(null);
              setOpen(a);
            }}
            data-op={a}
          >
            {SPECS[a].label}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        id="operator"
        open={open !== null}
        title={spec?.title ?? ''}
        confirmLabel={spec?.confirm ?? ''}
        busy={busy}
        onConfirm={run}
        onClose={() => !busy && setOpen(null)}
      >
        <p>{spec?.body}</p>
        {open === 'continue_review' && reviewNote && <p data-review-note>{reviewNote}</p>}
        {spec?.field &&
          (spec.field.multiline ? (
            <label style={{ display: 'grid', gap: 6 }}>
              <span>{spec.field.label}</span>
              <textarea
                value={value}
                maxLength={spec.field.max}
                onChange={(e) => setValue(e.target.value)}
                data-op-input
                style={{
                  minHeight: 96,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid var(--color-line, #ddd)',
                  font: 'inherit',
                }}
              />
            </label>
          ) : (
            <TextField
              label={spec.field.label}
              value={value}
              maxLength={spec.field.max}
              ltr={spec.field.ltr}
              onChange={(e) => setValue(e.target.value)}
              data-op-input
            />
          ))}
      </ConfirmDialog>
    </div>
  );
}
