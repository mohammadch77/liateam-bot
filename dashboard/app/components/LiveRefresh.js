'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const EVERY_MS = 10_000;

/**
 * Keeps every page live: polls a tiny fingerprint and, when the data changed, re-renders the
 * server components in place (router.refresh) - inputs, filters, open dialogs and scroll stay put.
 * Pauses while the tab is hidden and checks again as soon as it is visible.
 */
export default function LiveRefresh() {
  const router = useRouter();
  const last = useRef(null);
  const [state, setState] = useState({ ok: true, at: null });

  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (res.status === 401) return window.location.assign('/login');
        const { v } = await res.json();
        if (last.current !== null && v !== last.current) router.refresh();
        last.current = v;
        if (!stop) setState({ ok: v !== 'db-down', at: Date.now() });
      } catch {
        if (!stop) setState((s) => ({ ...s, ok: false }));
      }
    };
    check();
    const t = setInterval(check, EVERY_MS);
    const onVisible = () => !document.hidden && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [router]);

  return (
    <span className={`live ${state.ok ? 'on' : 'off'}`} title={state.ok ? 'به‌روزرسانی خودکار فعال است' : 'اتصال به سرور برقرار نیست'}>
      <span className="live-dot" />{state.ok ? 'زنده' : 'قطع'}
    </span>
  );
}
