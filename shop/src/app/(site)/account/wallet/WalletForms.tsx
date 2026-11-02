'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatToman } from '@/lib/format/money';
import { maskIban } from '@/lib/wallet/iban';
import { Alert, Badge, Button, TextField } from '@/ui';
import { ConfirmDialog } from '../_ui/ConfirmDialog';
import s from '../account.module.css';
import { cancelWithdrawalAction, requestWithdrawalAction, startTopupAction } from './actions';

/** digits in any script → a number (the field is typed by people) */
const toNumber = (v: string) => Number(v.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^0-9]/g, ''));

export function TopupForm({
  online,
  min,
  max,
  presets,
}: {
  online: boolean;
  min: number;
  max: number;
  presets: number[];
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await startTopupAction(toNumber(value));
      if (r.ok) window.location.assign(r.data.url);
      else setError(r.error);
    });
  return (
    <section className={`${s.card} ${s.wide}`} aria-label="شارژ کیف پول" data-topup>
      <h2 className={s.h2}>شارژ کیف پول</h2>
      {!online && <Alert tone="warning">پرداخت آنلاین فعلاً در دسترس نیست؛ شارژ کیف پول هم ممکن نیست.</Alert>}
      <p className={s.muted}>
        مبلغ شارژ بین {formatToman(min)} و {formatToman(max)} تومان. موجودی کیف پول فقط در همین سایت خرج می‌شود.
      </p>
      <div className={s.btnRow}>
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className={s.chip}
            onClick={() => setValue(String(p))}
            disabled={!online}
            data-topup-preset={p}
          >
            {formatToman(p)}
          </button>
        ))}
      </div>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="مبلغ شارژ (تومان)"
          name="amount"
          inputMode="numeric"
          ltr
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!online}
          required
        />
        {error && <Alert tone="danger">{error}</Alert>}
        <div>
          <Button type="submit" icon="add" disabled={!online} loading={pending} loadingText="در حال انتقال به درگاه…" data-topup-submit>
            شارژ کیف پول
          </Button>
        </div>
      </form>
    </section>
  );
}

export function WithdrawForm({ min, max, withdrawable }: { min: number; max: number; withdrawable: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const submit = (form: FormData) =>
    start(async () => {
      setMsg(null);
      const r = await requestWithdrawalAction({
        amount: toNumber(String(form.get('amount') ?? '')),
        iban: String(form.get('iban') ?? ''),
        holderName: String(form.get('holder') ?? ''),
      });
      setMsg(r.ok ? { ok: true, text: 'درخواست برداشت ثبت شد و مبلغ آن از موجودی کسر شد.' } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  return (
    <section className={`${s.card} ${s.wide}`} aria-label="درخواست برداشت" data-withdraw>
      <h2 className={s.h2}>درخواست برداشت</h2>
      <p className={s.muted}>
        قابل برداشت: <b className="tnum">{formatToman(withdrawable)}</b> تومان · حداقل {formatToman(min)} و حداکثر هر
        درخواست {formatToman(max)} تومان. پرداخت را اپراتور به‌صورت دستی انجام می‌دهد.
      </p>
      <form action={submit} className={s.form}>
        <div className={s.grid}>
          <TextField label="مبلغ (تومان)" name="amount" inputMode="numeric" ltr required />
          <TextField label="نام صاحب حساب" name="holder" autoComplete="name" required />
          <div className={s.span2}>
            <TextField label="شماره‌ی شبا" name="iban" ltr placeholder="IR…" autoComplete="off" required />
          </div>
        </div>
        {msg && <Alert tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Alert>}
        <div>
          <Button type="submit" icon="check" loading={pending} loadingText="در حال ثبت…" data-withdraw-submit>
            ثبت درخواست برداشت
          </Button>
        </div>
      </form>
    </section>
  );
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'inStock' | 'outOfStock' }> = {
  pending: { label: 'در حال بررسی', tone: 'neutral' },
  paid: { label: 'پرداخت شد', tone: 'inStock' },
  rejected: { label: 'رد شد', tone: 'outOfStock' },
  canceled: { label: 'لغو شد', tone: 'outOfStock' },
};
const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });

export type WithdrawalView = {
  id: string;
  amount: number;
  iban_last4: string;
  holder_name: string;
  status: string;
  paid_ref: string | null;
  reject_reason: string | null;
  created_at: string;
};

export function WithdrawalList({ items }: { items: WithdrawalView[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState<WithdrawalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cancel = () =>
    start(async () => {
      const w = asking;
      if (!w) return;
      const r = await cancelWithdrawalAction(w.id);
      setAsking(null);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  if (!items.length) return null;
  return (
    <section className={`${s.card} ${s.wide}`} aria-label="درخواست‌های برداشت" data-withdrawals>
      <h2 className={s.h2}>درخواست‌های برداشت</h2>
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className={s.rows}>
        {items.map((w) => (
          <li key={w.id} className={s.row} data-withdrawal={w.status}>
            <div className={s.rowMain}>
              <b className="tnum">{formatToman(w.amount)} تومان</b>
              <span className={s.muted}>
                {dateFa.format(new Date(w.created_at))} · <span dir="ltr">{maskIban(w.iban_last4)}</span>
              </span>
              {w.paid_ref && (
                <span className={s.muted}>
                  کد پیگیری: <span dir="ltr">{w.paid_ref}</span>
                </span>
              )}
              {w.reject_reason && <span className={s.muted}>دلیل: {w.reject_reason}</span>}
            </div>
            <Badge tone={STATUS[w.status]?.tone ?? 'neutral'}>{STATUS[w.status]?.label ?? w.status}</Badge>
            {w.status === 'pending' && (
              <Button variant="outline" size="sm" onClick={() => setAsking(w)} data-withdraw-cancel>
                لغو درخواست
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        id="withdraw-cancel"
        open={asking !== null}
        title="لغو درخواست برداشت"
        confirmLabel="بله، لغو شود"
        busy={pending}
        onConfirm={cancel}
        onClose={() => setAsking(null)}
      >
        <p>درخواست لغو می‌شود و مبلغ آن به کیف پول شما برمی‌گردد.</p>
      </ConfirmDialog>
    </section>
  );
}
