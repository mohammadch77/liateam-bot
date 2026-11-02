'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatToman } from '@/lib/format/money';
import { cartPath } from '@/lib/urls';
import { Alert, Button } from '@/ui';
import { ConfirmDialog } from '../../_ui/ConfirmDialog';
import s from '../../account.module.css';
import { cancelOrderAction } from './actions';

/**
 * «لغو سفارش» and «ویرایش سفارش», each behind a second confirmation that says what will happen and how much returns to the
 * wallet. The server decides again (status, lock, switch); this panel only shows the buttons the status allows.
 * `plan`: simple (nothing paid) · refund (paid, whole amount returns) · request (an operator confirms; no edit).
 */
export function CancelPanel({
  number,
  plan,
  refund,
  canEdit,
}: {
  number: string;
  plan: 'simple' | 'refund' | 'request';
  refund: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState<'cancel' | 'edit' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const confirm = () =>
    start(async () => {
      const mode = ask;
      if (!mode) return;
      const r = await cancelOrderAction(number, mode);
      setAsk(null);
      if (!r.ok) {
        setResult({ ok: false, text: r.error });
        router.refresh(); // the status may have moved meanwhile: show it as it is
        return;
      }
      if (mode === 'edit') {
        router.push(cartPath());
        return;
      }
      setResult({ ok: true, text: r.data.message });
      router.refresh();
    });

  const money = refund > 0 ? `${formatToman(refund)} تومان` : '';
  return (
    <section className={`${s.card} ${s.wide}`} aria-label="لغو یا ویرایش سفارش" data-cancel-panel>
      <h2 className={s.h2}>لغو یا ویرایش سفارش</h2>
      {result && <Alert tone={result.ok ? 'success' : 'danger'}>{result.text}</Alert>}
      {plan === 'request' && (
        <p className={s.muted}>
          سفارش در حال ثبت یا ثبت‌شده نزد تأمین‌کننده است؛ لغو آن نیاز به تأیید اپراتور دارد و مبلغ پس از تأیید به کیف
          پول برمی‌گردد.
        </p>
      )}
      <div className={s.btnRow}>
        <Button variant="outline" onClick={() => setAsk('cancel')} data-cancel-open>
          {plan === 'request' ? 'درخواست لغو سفارش' : 'لغو سفارش'}
        </Button>
        {canEdit && (
          <Button variant="ghost" onClick={() => setAsk('edit')} data-edit-open>
            ویرایش سفارش
          </Button>
        )}
      </div>
      <ConfirmDialog
        id="order-cancel"
        open={ask === 'cancel'}
        title={plan === 'request' ? 'ثبت درخواست لغو' : 'لغو سفارش'}
        confirmLabel={plan === 'request' ? 'ثبت درخواست' : 'بله، لغو شود'}
        busy={pending}
        onConfirm={confirm}
        onClose={() => setAsk(null)}
      >
        {plan === 'refund' && (
          <p data-cancel-refund>
            سفارش لغو می‌شود و <b>{money}</b> به کیف پول شما برمی‌گردد. این کار قابل بازگشت نیست.
          </p>
        )}
        {plan === 'simple' && <p>سفارش لغو می‌شود. مبلغی از شما کم نشده است.</p>}
        {plan === 'request' && (
          <p>
            درخواست لغو ثبت می‌شود و پس از تأیید اپراتور مبلغ به کیف پول شما برمی‌گردد. تا آن زمان سفارش لغو‌شده حساب
            نمی‌شود.
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        id="order-edit"
        open={ask === 'edit'}
        title="ویرایش سفارش"
        confirmLabel="لغو و آماده‌سازی سبد"
        busy={pending}
        onConfirm={confirm}
        onClose={() => setAsk(null)}
      >
        <p data-edit-note>
          {refund > 0
            ? `سفارش فعلی لغو و مبلغ ${money} به کیف پول برمی‌گردد؛ سبد برای ویرایش آماده می‌شود.`
            : 'سفارش فعلی لغو می‌شود (مبلغی پرداخت نشده است)؛ سبد برای ویرایش آماده می‌شود.'}{' '}
          بعد از تغییر، دوباره تسویه می‌کنید و قیمت و موجودی از نو بررسی می‌شود.
        </p>
      </ConfirmDialog>
    </section>
  );
}
