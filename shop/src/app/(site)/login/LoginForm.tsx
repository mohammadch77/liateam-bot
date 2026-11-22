'use client';

import { Fragment, useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { toLatinDigits } from '@/lib/phone';
import { Button } from '@/ui/button/Button';
import { Alert } from '@/ui/feedback/Feedback';
import { TextField } from '@/ui/field/TextField';
import { Icon } from '@/ui/icon/Icon';
import {
  completeRegisterAction,
  completeResetPasswordAction,
  loginPasswordAction,
  requestLoginOtpAction,
  requestRegisterOtpAction,
  requestResetOtpAction,
  verifyLoginOtpAction,
  verifyRegisterOtpAction,
  verifyResetOtpAction,
  type OtpRequestData,
} from './actions';
import s from './login.module.css';

type View =
  | { kind: 'login-password' }
  | { kind: 'login-otp-phone' }
  | { kind: 'login-otp-code'; sent: OtpRequestData & { at: number } }
  | { kind: 'register-phone' }
  | { kind: 'register-code'; sent: OtpRequestData & { at: number } }
  | { kind: 'register-password'; phone: string; masked: string; proofToken: string }
  | { kind: 'forgot-phone' }
  | { kind: 'forgot-code'; sent: OtpRequestData & { at: number } }
  | { kind: 'forgot-password'; phone: string; masked: string; proofToken: string };

/**
 * Phones: when a field gets focus the keyboard slides up a moment later; then the field is scrolled to the middle
 * of what is left, so the keyboard never covers it or its button.
 */
function useKeepFocusedFieldInView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (!t.matches('input')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        t.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      }, 300);
    };
    el.addEventListener('focusin', onFocus);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('focusin', onFocus);
    };
  }, []);
  return ref;
}

export function LoginForm({
  next,
  initialRefCode = '',
  initialMode = 'login',
}: {
  next: string;
  initialRefCode?: string;
  initialMode?: 'login' | 'register';
}) {
  const keepInView = useKeepFocusedFieldInView();
  const [view, setView] = useState<View>(() =>
    initialMode === 'register' ? { kind: 'register-phone' } : { kind: 'login-password' },
  );
  // Shared phone & referral state across mode switches so users never have to retype their number
  const [phone, setPhone] = useState('');
  const [refCode, setRefCode] = useState(initialRefCode);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const switchView = (target: View, opts?: { keepNotice?: boolean }) => {
    setError(null);
    if (!opts?.keepNotice) setNotice(null);
    setView(target);
  };

  const showPrimaryTabs =
    view.kind === 'login-password' || view.kind === 'login-otp-phone' || view.kind === 'register-phone';
  const isRegisterTab = view.kind.startsWith('register-');

  // ── 1. Login with Phone + Password ──
  const onLoginPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phoneVal = String(form.get('phone') ?? '');
    setPhone(phoneVal);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await loginPasswordAction(form);
      if (r && !r.ok) setError({ message: r.error, code: r.code });
    });
  };

  // ── 2. Login with SMS OTP (Request) ──
  const onRequestLoginOtp = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phoneVal = String(form.get('phone') ?? '');
    setPhone(phoneVal);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await requestLoginOtpAction(form);
      if (!r.ok) {
        setError({ message: r.error, code: r.code });
        return;
      }
      setPhone(r.data.phone);
      setView({ kind: 'login-otp-code', sent: { ...r.data, at: Date.now() } });
    });
  };

  // ── 3. Registration (Request OTP + optional Referral Code) ──
  const onRequestRegisterOtp = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phoneVal = String(form.get('phone') ?? '');
    const refVal = String(form.get('ref') ?? '');
    setPhone(phoneVal);
    setRefCode(refVal);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await requestRegisterOtpAction(form);
      if (!r.ok) {
        setError({ message: r.error, code: r.code });
        return;
      }
      setPhone(r.data.phone);
      setView({ kind: 'register-code', sent: { ...r.data, at: Date.now() } });
    });
  };

  // ── 4. Forgot Password (Request Reset OTP) ──
  const onRequestResetOtp = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const phoneVal = String(form.get('phone') ?? '');
    setPhone(phoneVal);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await requestResetOtpAction(form);
      if (!r.ok) {
        setError({ message: r.error, code: r.code });
        return;
      }
      setPhone(r.data.phone);
      setView({ kind: 'forgot-code', sent: { ...r.data, at: Date.now() } });
    });
  };

  return (
    <div ref={keepInView} className={s.steps} data-auth-step={view.kind}>
      {showPrimaryTabs && (
        <div className={s.tabs} role="tablist" aria-label="انتخاب حالت ورود یا ثبت‌نام">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegisterTab}
            className={`${s.tab} ${!isRegisterTab ? s.tabActive : ''}`}
            data-auth-tab="login"
            onClick={() => switchView({ kind: 'login-password' })}
          >
            <Icon name="login" size={18} />
            ورود
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegisterTab}
            className={`${s.tab} ${isRegisterTab ? s.tabActive : ''}`}
            data-auth-tab="register"
            onClick={() => switchView({ kind: 'register-phone' })}
          >
            <Icon name="person_add" size={18} />
            ثبت‌نام
          </button>
        </div>
      )}

      {notice && <Alert tone="success">{notice}</Alert>}

      {/* ────────────────── LOGIN: PHONE + PASSWORD ────────────────── */}
      {view.kind === 'login-password' && (
        <>
          <div className={s.headRow}>
            <h1 id="login-title" className={s.title}>
              ورود به حساب کاربری
            </h1>
            <p className={s.lead}>شماره موبایل و رمز عبور خود را وارد کنید.</p>
          </div>

          {error && <Alert tone="danger">{error.message}</Alert>}

          <form onSubmit={onLoginPassword} className={s.form} noValidate>
            <input type="hidden" name="next" value={next} />
            <TextField
              name="phone"
              label="شماره موبایل"
              ltr
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
              maxLength={16}
              enterKeyHint="next"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            <PasswordField
              name="password"
              label="رمز عبور"
              autoComplete="current-password"
              placeholder="رمز عبور خود را وارد کنید"
              enterKeyHint="done"
              required
              labelRight={
                <button
                  type="button"
                  className={s.forgotInline}
                  data-auth-forgot
                  onClick={() => switchView({ kind: 'forgot-phone' })}
                >
                  فراموشی رمز عبور؟
                </button>
              }
            />
            <Button type="submit" size="lg" block loading={pending} loadingText="در حال ورود…">
              ورود به حساب کاربری
            </Button>
          </form>

          <div className={s.divider}>یا</div>

          <Button
            type="button"
            variant="outline"
            size="md"
            block
            icon="sms"
            data-auth-login-otp
            onClick={() => switchView({ kind: 'login-otp-phone' })}
          >
            ورود با کد پیامکی یک‌بارمصرف
          </Button>

          <div className={s.switchBox}>
            <span>حساب کاربری ندارید؟</span>
            <button
              type="button"
              className={s.link}
              data-auth-go-register
              onClick={() => switchView({ kind: 'register-phone' })}
            >
              ثبت‌نام کنید
            </button>
          </div>
          <p className={s.terms}>ورود شما به معنای پذیرش شرایط و قوانین حریم خصوصی فروشگاه است.</p>
        </>
      )}

      {/* ────────────────── LOGIN: SMS OTP (STEP 1: PHONE) ────────────────── */}
      {view.kind === 'login-otp-phone' && (
        <>
          <div className={s.headRow}>
            <button
              type="button"
              className={s.backBtn}
              onClick={() => switchView({ kind: 'login-password' })}
            >
              <Icon name="arrow_forward" size={16} />
              ورود با رمز عبور
            </button>
            <h1 id="login-title" className={s.title}>
              ورود با کد پیامکی
            </h1>
            <p className={s.lead}>شماره موبایل ثبت‌شده خود را وارد کنید تا کد تأیید پیامک شود.</p>
          </div>

          {error && (
            <Alert
              tone="danger"
              action={
                error.code === 'NOT_FOUND' ? (
                  <button
                    type="button"
                    className={s.alertBtn}
                    onClick={() => switchView({ kind: 'register-phone' })}
                  >
                    ثبت‌نام کنید
                  </button>
                ) : undefined
              }
            >
              {error.message}
            </Alert>
          )}

          <form onSubmit={onRequestLoginOtp} className={s.form} noValidate>
            <TextField
              name="phone"
              label="شماره موبایل"
              ltr
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
              maxLength={16}
              enterKeyHint="send"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            <Button type="submit" size="lg" block loading={pending} loadingText="در حال ارسال کد…">
              دریافت کد تأیید
            </Button>
          </form>

          <div className={s.switchBox}>
            <span>ثبت‌نام نکرده‌اید؟</span>
            <button
              type="button"
              className={s.link}
              onClick={() => switchView({ kind: 'register-phone' })}
            >
              ایجاد حساب کاربری
            </button>
          </div>
        </>
      )}

      {/* ────────────────── LOGIN: SMS OTP (STEP 2: CODE) ────────────────── */}
      {view.kind === 'login-otp-code' && (
        <OtpCodeStep
          key={view.sent.at}
          sent={view.sent}
          title="کد تأیید ورود را وارد کنید"
          submitLabel="تأیید و ورود"
          onEditPhone={() => switchView({ kind: 'login-otp-phone' })}
          onResend={async () => {
            const fd = new FormData();
            fd.set('phone', view.sent.phone);
            const r = await requestLoginOtpAction(fd);
            if (!r.ok) return r.error;
            setView({ kind: 'login-otp-code', sent: { ...r.data, at: Date.now() } });
            return null;
          }}
          onVerify={async (code) => {
            const fd = new FormData();
            fd.set('phone', view.sent.phone);
            fd.set('code', code);
            fd.set('next', next);
            const r = await verifyLoginOtpAction(fd);
            if (r && !r.ok) return { error: r.error, code: r.code };
            return null;
          }}
        />
      )}

      {/* ────────────────── REGISTER (STEP 1: PHONE + OPTIONAL REFERRAL) ────────────────── */}
      {view.kind === 'register-phone' && (
        <>
          <Stepper steps={['شماره موبایل', 'کد تأیید', 'رمز عبور']} current={1} />
          <div className={s.headRow}>
            <h1 id="login-title" className={s.title}>
              ایجاد حساب کاربری
            </h1>
            <p className={s.lead}>شماره موبایل خود را وارد کنید تا کد تأیید پیامک شود.</p>
          </div>

          {error && (
            <Alert
              tone="danger"
              action={
                error.code === 'CONFLICT' ? (
                  <button
                    type="button"
                    className={s.alertBtn}
                    onClick={() => switchView({ kind: 'login-password' })}
                  >
                    رفتن به ورود
                  </button>
                ) : undefined
              }
            >
              {error.message}
            </Alert>
          )}

          <form onSubmit={onRequestRegisterOtp} className={s.form} noValidate>
            <TextField
              name="phone"
              label="شماره موبایل"
              ltr
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
              maxLength={16}
              enterKeyHint="next"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            <TextField
              name="ref"
              label="کد معرف"
              labelNote="اختیاری"
              ltr
              autoCapitalize="none"
              autoComplete="off"
              maxLength={20}
              value={refCode}
              onChange={(e) => setRefCode(e.target.value)}
              hint="اگر کسی شما را معرفی کرده، کدش را وارد کنید (مخصوص ثبت‌نام اولیه)."
            />
            <Button type="submit" size="lg" block loading={pending} loadingText="در حال ارسال کد…">
              دریافت کد تأیید
            </Button>
          </form>

          <div className={s.switchBox}>
            <span>قبلاً ثبت‌نام کرده‌اید؟</span>
            <button
              type="button"
              className={s.link}
              data-auth-go-login
              onClick={() => switchView({ kind: 'login-password' })}
            >
              وارد شوید
            </button>
          </div>
          <p className={s.terms}>ثبت‌نام شما به معنای پذیرش شرایط و قوانین حریم خصوصی فروشگاه است.</p>
        </>
      )}

      {/* ────────────────── REGISTER (STEP 2: OTP CODE) ────────────────── */}
      {view.kind === 'register-code' && (
        <>
          <Stepper steps={['شماره موبایل', 'کد تأیید', 'رمز عبور']} current={2} />
          <OtpCodeStep
            key={view.sent.at}
            sent={view.sent}
            title="تأیید شماره موبایل"
            submitLabel="تأیید کد و ادامه"
            onEditPhone={() => switchView({ kind: 'register-phone' })}
            onResend={async () => {
              const fd = new FormData();
              fd.set('phone', view.sent.phone);
              if (refCode.trim()) fd.set('ref', refCode.trim());
              const r = await requestRegisterOtpAction(fd);
              if (!r.ok) return r.error;
              setView({ kind: 'register-code', sent: { ...r.data, at: Date.now() } });
              return null;
            }}
            onVerify={async (code) => {
              const fd = new FormData();
              fd.set('phone', view.sent.phone);
              fd.set('code', code);
              const r = await verifyRegisterOtpAction(fd);
              if (!r.ok) return { error: r.error, code: r.code };
              setView({
                kind: 'register-password',
                phone: r.data.phone,
                masked: r.data.masked,
                proofToken: r.data.proofToken,
              });
              return null;
            }}
          />
        </>
      )}

      {/* ────────────────── REGISTER (STEP 3: SET MANDATORY SIMPLE PASSWORD) ────────────────── */}
      {view.kind === 'register-password' && (
        <>
          <Stepper steps={['شماره موبایل', 'کد تأیید', 'رمز عبور']} current={3} />
          <SetPasswordStep
            title="انتخاب رمز عبور"
            lead={
              <>
                شماره{' '}
                <b dir="ltr" className={s.phone}>
                  {view.masked}
                </b>{' '}
                تأیید شد. لطفاً یک رمز عبور برای حساب خود تعیین کنید.
              </>
            }
            passwordLabel="رمز عبور"
            confirmLabel="تکرار رمز عبور"
            submitLabel="تکمیل ثبت‌نام و ورود"
            pendingLabel="در حال ساخت حساب…"
            onSubmit={async (password, confirmPassword) => {
              const fd = new FormData();
              fd.set('proofToken', view.proofToken);
              fd.set('password', password);
              fd.set('confirmPassword', confirmPassword);
              fd.set('next', next);
              const r = await completeRegisterAction(fd);
              if (r && !r.ok) return r.error;
              return null;
            }}
          />
        </>
      )}

      {/* ────────────────── FORGOT PASSWORD (STEP 1: PHONE) ────────────────── */}
      {view.kind === 'forgot-phone' && (
        <>
          <Stepper steps={['شماره موبایل', 'کد بازیابی', 'رمز جدید']} current={1} />
          <div className={s.headRow}>
            <button
              type="button"
              className={s.backBtn}
              onClick={() => switchView({ kind: 'login-password' })}
            >
              <Icon name="arrow_forward" size={16} />
              بازگشت به ورود
            </button>
            <h1 id="login-title" className={s.title}>
              فراموشی رمز عبور
            </h1>
            <p className={s.lead}>شماره موبایل ثبت‌شده خود را وارد کنید تا کد بازیابی رمز برایتان پیامک شود.</p>
          </div>

          {error && (
            <Alert
              tone="danger"
              action={
                error.code === 'NOT_FOUND' ? (
                  <button
                    type="button"
                    className={s.alertBtn}
                    onClick={() => switchView({ kind: 'register-phone' })}
                  >
                    ثبت‌نام کنید
                  </button>
                ) : undefined
              }
            >
              {error.message}
            </Alert>
          )}

          <form onSubmit={onRequestResetOtp} className={s.form} noValidate>
            <TextField
              name="phone"
              label="شماره موبایل"
              ltr
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="۰۹۱۲ ۳۴۵ ۶۷۸۹"
              maxLength={16}
              enterKeyHint="send"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoFocus
            />
            <Button type="submit" size="lg" block loading={pending} loadingText="در حال ارسال کد…">
              ارسال کد بازیابی
            </Button>
          </form>
        </>
      )}

      {/* ────────────────── FORGOT PASSWORD (STEP 2: OTP CODE) ────────────────── */}
      {view.kind === 'forgot-code' && (
        <>
          <Stepper steps={['شماره موبایل', 'کد بازیابی', 'رمز جدید']} current={2} />
          <OtpCodeStep
            key={view.sent.at}
            sent={view.sent}
            title="کد بازیابی رمز را وارد کنید"
            submitLabel="تأیید کد"
            onEditPhone={() => switchView({ kind: 'forgot-phone' })}
            onResend={async () => {
              const fd = new FormData();
              fd.set('phone', view.sent.phone);
              const r = await requestResetOtpAction(fd);
              if (!r.ok) return r.error;
              setView({ kind: 'forgot-code', sent: { ...r.data, at: Date.now() } });
              return null;
            }}
            onVerify={async (code) => {
              const fd = new FormData();
              fd.set('phone', view.sent.phone);
              fd.set('code', code);
              const r = await verifyResetOtpAction(fd);
              if (!r.ok) return { error: r.error, code: r.code };
              setView({
                kind: 'forgot-password',
                phone: r.data.phone,
                masked: r.data.masked,
                proofToken: r.data.proofToken,
              });
              return null;
            }}
          />
        </>
      )}

      {/* ────────────────── FORGOT PASSWORD (STEP 3: NEW PASSWORD TWICE) ────────────────── */}
      {view.kind === 'forgot-password' && (
        <>
          <Stepper steps={['شماره موبایل', 'کد بازیابی', 'رمز جدید']} current={3} />
          <SetPasswordStep
            title="تعیین رمز عبور جدید"
            lead={
              <>
                رمز عبور جدید حساب{' '}
                <b dir="ltr" className={s.phone}>
                  {view.masked}
                </b>{' '}
                را دو بار وارد کنید.
              </>
            }
            passwordLabel="رمز عبور جدید"
            confirmLabel="تکرار رمز عبور جدید"
            submitLabel="ذخیره رمز عبور جدید"
            pendingLabel="در حال ذخیره رمز جدید…"
            onSubmit={async (password, confirmPassword) => {
              const fd = new FormData();
              fd.set('proofToken', view.proofToken);
              fd.set('password', password);
              fd.set('confirmPassword', confirmPassword);
              const r = await completeResetPasswordAction(fd);
              if (!r.ok) return r.error;
              setPhone(r.data.phone);
              setError(null);
              setNotice('رمز عبور جدید با موفقیت ثبت شد. اکنون با شماره موبایل و رمز جدید وارد شوید.');
              setView({ kind: 'login-password' });
              return null;
            }}
          />
        </>
      )}
    </div>
  );
}

/* ────────────────── Shared Subcomponents ────────────────── */

function Stepper({ steps, current }: { steps: readonly [string, string, string]; current: 1 | 2 | 3 }) {
  return (
    <ol className={s.stepper} aria-label="مراحل">
      {steps.map((label, idx) => {
        const num = idx + 1;
        const done = num < current;
        const active = num === current;
        return (
          <Fragment key={label}>
            {idx > 0 && <li className={`${s.stepLine} ${done || active ? s.stepLineDone : ''}`} aria-hidden="true" />}
            <li
              className={`${s.stepItem} ${active ? s.stepActive : ''} ${done ? s.stepDone : ''}`}
              aria-current={active ? 'step' : undefined}
            >
              <span className={s.stepDot} aria-hidden="true">
                {done ? <Icon name="check" size={14} /> : toFaDigits(num)}
              </span>
              <span>{label}</span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function PasswordField({
  name,
  label,
  labelRight,
  hint,
  error,
  placeholder,
  autoComplete,
  enterKeyHint,
  required,
  autoFocus,
}: {
  name: string;
  label: string;
  labelRight?: ReactNode;
  hint?: string;
  error?: string;
  placeholder?: string;
  autoComplete?: string;
  enterKeyHint?: 'done' | 'next' | 'go' | 'send';
  required?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={s.pwField}>
      <div className={s.pwLabelRow}>
        <label htmlFor={id} className={s.pwLabel}>
          {label}
        </label>
        {labelRight}
      </div>
      <div className={s.pwWrap}>
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          className={s.pwInput}
          placeholder={placeholder}
          autoComplete={autoComplete}
          enterKeyHint={enterKeyHint}
          required={required}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className={s.pwToggle}
          aria-label={visible ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          <Icon name={visible ? 'visibility_off' : 'visibility'} size={20} />
        </button>
      </div>
      {error ? (
        <span id={`${id}-error`} className={s.pwError}>
          <Icon name="error" size={16} />
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className={s.pwHint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}

function OtpCodeStep({
  sent,
  title,
  submitLabel,
  onEditPhone,
  onResend,
  onVerify,
}: {
  sent: OtpRequestData & { at: number };
  title: string;
  submitLabel: string;
  onEditPhone: () => void;
  onResend: () => Promise<string | null>;
  onVerify: (code: string) => Promise<{ error: string; code?: string } | null>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [verifyError, setVerifyError] = useState<{ error: string; code?: string } | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [verifying, startVerify] = useTransition();
  const [resending, startResend] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.ceil((sent.at + sent.resendAfterSeconds * 1000 - now) / 1000));
  const locked = verifyError?.code === 'LOCKED';

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setVerifyError(null);
    setResendError(null);
    startVerify(async () => {
      const res = await onVerify(code);
      if (res) {
        setVerifyError(res);
        codeRef.current?.select();
      }
    });
  };

  const handleResend = () => {
    setResendError(null);
    setVerifyError(null);
    startResend(async () => {
      const err = await onResend();
      if (err) setResendError(err);
    });
  };

  return (
    <>
      <div className={s.headRow}>
        <h1 id="login-title" className={s.title}>
          {title}
        </h1>
        <p className={s.lead}>
          کد ۶ رقمی به شماره{' '}
          <b dir="ltr" className={s.phone}>
            {sent.masked}
          </b>{' '}
          پیامک شد.
        </p>
      </div>

      <form onSubmit={handleSubmit} className={s.form} noValidate>
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
          error={verifyError?.error}
        />
        <Button
          type="submit"
          size="lg"
          block
          loading={verifying}
          loadingText="در حال بررسی…"
          disabled={locked}
        >
          {submitLabel}
        </Button>
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
          <button type="button" className={s.link} disabled={resending} onClick={handleResend}>
            {resending ? 'در حال ارسال…' : 'ارسال دوباره کد'}
          </button>
        )}
      </div>
    </>
  );
}

function SetPasswordStep({
  title,
  lead,
  passwordLabel,
  confirmLabel,
  submitLabel,
  pendingLabel,
  onSubmit,
}: {
  title: string;
  lead: ReactNode;
  passwordLabel: string;
  confirmLabel: string;
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (password: string, confirmPassword: string) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const pw = toLatinDigits(String(fd.get('password') ?? ''));
    const confirm = toLatinDigits(String(fd.get('confirmPassword') ?? ''));

    if (pw.length < 4) {
      setError('رمز عبور باید حداقل ۴ کاراکتر باشد.');
      return;
    }
    if (pw !== confirm) {
      setError('رمز عبور و تکرار آن یکسان نیستند.');
      return;
    }

    setError(null);
    startTransition(async () => {
      const err = await onSubmit(pw, confirm);
      if (err) setError(err);
    });
  };

  return (
    <>
      <div className={s.headRow}>
        <h1 id="login-title" className={s.title}>
          {title}
        </h1>
        <p className={s.lead}>{lead}</p>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <PasswordField
          name="password"
          label={passwordLabel}
          autoComplete="new-password"
          placeholder="حداقل ۴ کاراکتر"
          hint="هر ترکیب ساده‌ای از عدد یا حروف دلخواه (حداقل ۴ کاراکتر)؛ نیازی به حروف بزرگ یا علامت نیست."
          enterKeyHint="next"
          required
          autoFocus
        />
        <PasswordField
          name="confirmPassword"
          label={confirmLabel}
          autoComplete="new-password"
          placeholder="رمز عبور را مجدداً وارد کنید"
          enterKeyHint="done"
          required
        />
        <Button type="submit" size="lg" block loading={pending} loadingText={pendingLabel}>
          {submitLabel}
        </Button>
      </form>
    </>
  );
}
