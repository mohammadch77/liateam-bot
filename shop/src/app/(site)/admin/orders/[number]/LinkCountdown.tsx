'use client';

import { useEffect, useState } from 'react';
import { toFaDigits } from '@/lib/format/number';

/** The time left on Liateam's payment link, counting down each second to the moment given (a server time). */
export function LinkCountdown({ expiresAt, remindMinutes }: { expiresAt: string; remindMinutes: number }) {
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [end]);
  if (left === null) return <span data-countdown="pending">…</span>;
  const m = Math.floor(left / 60_000);
  const sec = Math.floor((left % 60_000) / 1000);
  const state = left <= 0 ? 'expired' : left <= remindMinutes * 60_000 ? 'expiring' : 'active';
  return (
    <b className="tnum" data-countdown={state} dir="ltr">
      {left <= 0 ? 'منقضی شد' : toFaDigits(`${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`)}
    </b>
  );
}
