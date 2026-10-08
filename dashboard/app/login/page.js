'use client';
import { useActionState } from 'react';
import { login } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <div className="login">
      <form className="card" action={action}>
        <div className="brand" style={{ padding: '0 0 16px' }}><span className="brand-dot" />داشبورد همگام‌ساز لیاتیم</div>
        <div className="field">
          <label htmlFor="user">نام کاربری</label>
          <input className="input" id="user" name="user" autoComplete="username" required dir="ltr" defaultValue={state?.user} key={state?.user ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="password">رمز عبور</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
        </div>
        {state?.error && <div className="banner bad" role="alert">{state.error}</div>}
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={pending}>{pending ? 'در حال ورود…' : 'ورود'}</button>
      </form>
    </div>
  );
}
