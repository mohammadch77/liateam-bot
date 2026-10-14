'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatNumber } from '@/lib/format/number';
import { Alert } from '@/ui/feedback/Feedback';
import { Button } from '@/ui/button/Button';
import { TextField } from '@/ui/field/TextField';
import { requestCodeAction, verifyCodeAction, type RequestCodeState } from './actions';
import s from './login.module.css';

type Sent = Extract<RequestCodeState, { ok: true }>['data'] & { at: number };
type SendState = { sent: Sent | null; error: string | null };

/**
 * Two steps on one page: phone number → SMS code. The send state keeps the last successful send, so a failed
 * resend shows its error on the code step instead of throwing the user back to the phone step.
 */
export function LoginForm({ next }: { next: string }) {
  const [send, sendAction] = useActionState<SendState, FormData>(
    async (prev, form) => {
      const r = await requestCodeAction(null, form);
      if (r?.ok) return { sent: { ...r.data, at: Date.now() }, error: null };
      return { sent: prev.sent, error: r?.ok === false ? r.error : null };
    },
    { sent: null, error: null },
  );
  // «ویرایش شماره» goes back to step 1 until the next successful send.
  const [editedAt, setEditedAt] = useState(0);
  const sent = send.sent && send.sent.at > editedAt ? send.sent : null;

  if (!sent) {
    return (
      <>
        <h1 id="login-title" className={s.title}>
          ورود | ثبت‌نام
        </h1>
        <p className={s.lead}>شماره موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود.</p>
        <form action={sendAction} className={s.form} noValidate>
          <TextField
            name="phone"
            label="شماره موبایل"
            ltr
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
            maxLength={16}
            defaultValue={send.sent?.phone}
            required
            autoFocus
            error={send.error ?? undefined}
          />
          <Submit pendingText="در حال ارسال کد…">دریافت کد تأیید</Submit>
        </form>
        <p className={s.terms}>ورود شما به معنای پذیرش شرایط و قوانین حریم خصوصی فروشگاه است.</p>
      </>
    );
  }

  return (
    <CodeStep
      key={sent.at} // a new send remounts the step: fresh countdown, empty code field
      sent={sent}
      next={next}
      resendAction={sendAction}
      resendError={send.error}
      onEditPhone={() => setEditedAt(Date.now())}
    />
  );
}

function CodeStep({
  sent,
  next,
  resendAction,
  resendError,
  onEditPhone,
}: {
  sent: Sent;
  next: string;
  resendAction: (form: FormData) => void;
  resendError: string | null;
  onEditPhone: () => void;
}) {
  const [verifyState, verifyAction] = useActionState(verifyCodeAction, null);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((sent.at + sent.resendAfterSeconds * 1000 - now) / 1000));

  // After a wrong code: select it so the next try overwrites it.
  useEffect(() => {
    if (verifyState && !verifyState.ok) codeRef.current?.select();
  }, [verifyState]);

  const verifyError = verifyState && !verifyState.ok ? verifyState.error : null;
  const locked = verifyState?.ok === false && verifyState.code === 'LOCKED';

  return (
    <>
      <h1 id="login-title" className={s.title}>
        کد تأیید را وارد کنید
      </h1>
      <p className={s.lead}>
        کد ۶ رقمی به شماره{' '}
        <b dir="ltr" className={s.phone}>
          {sent.masked}
        </b>{' '}
        پیامک شد.
      </p>
      <form action={verifyAction} className={s.form} noValidate>
        <input type="hidden" name="phone" value={sent.phone} />
        <input type="hidden" name="next" value={next} />
        <TextField
          ref={codeRef}
          name="code"
          label="کد تأیید"
          ltr
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="------"
          required
          autoFocus
          disabled={locked}
          error={verifyError ?? undefined}
        />
        <Submit pendingText="در حال بررسی…" disabled={locked}>
          ورود
        </Submit>
      </form>

      {resendError && <Alert tone="danger">{resendError}</Alert>}

      <div className={s.row}>
        <button type="button" className={s.link} onClick={onEditPhone}>
          ویرایش شماره
        </button>
        {left > 0 ? (
          <span className={s.muted} aria-live="polite">
            ارسال دوباره تا {formatNumber(left)} ثانیه
          </span>
        ) : (
          <form action={resendAction}>
            <input type="hidden" name="phone" value={sent.phone} />
            <ResendButton />
          </form>
        )}
      </div>
    </>
  );
}

function Submit({
  children,
  pendingText,
  disabled,
}: {
  children: string;
  pendingText: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block loading={pending} loadingText={pendingText} disabled={disabled}>
      {children}
    </Button>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={s.link} disabled={pending}>
      {pending ? 'در حال ارسال…' : 'ارسال دوباره کد'}
    </button>
  );
}
