'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, TextField } from '@/ui';
import s from '../account.module.css';
import { saveNameAction } from './actions';

/** Name (editable) and mobile number (read-only: it is the sign-in). */
export function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const submit = (form: FormData) =>
    start(async () => {
      setMsg(null);
      const r = await saveNameAction(String(form.get('name') ?? ''));
      setMsg(r.ok ? { ok: true, text: 'نام شما ذخیره شد.' } : { ok: false, text: r.error });
    });
  return (
    <form action={submit} className={s.form} data-profile-form>
      <div className={s.grid}>
        <TextField label="نام و نام‌خانوادگی" name="name" defaultValue={name} autoComplete="name" required />
        <TextField label="شماره‌ی موبایل" value={phone} readOnly ltr hint="شماره‌ی موبایل ورود شما است و تغییر نمی‌کند." />
      </div>
      {msg && <Alert tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Alert>}
      <div>
        <Button type="submit" icon="check" loading={pending} loadingText="در حال ذخیره…">
          ذخیره
        </Button>
      </div>
    </form>
  );
}
