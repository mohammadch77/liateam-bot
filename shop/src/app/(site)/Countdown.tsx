'use client';

import { useEffect, useState } from 'react';
import { toFaDigits } from '@/lib/format/number';
import s from './offers-rail.module.css';

const pad = (n: number) => toFaDigits(String(n).padStart(2, '0'));

/**
 * Time left until `endsAt` (days when more than one, then hours : minutes : seconds), ticking every second. The
 * boxes have a fixed size and show «--» until the browser takes over, so nothing moves (no layout shift).
 */
export function Countdown({ endsAt, label }: { endsAt: string; label: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const end = new Date(endsAt).getTime();
    const tick = () => setLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  const parts =
    left === null
      ? null
      : {
          d: Math.floor(left / 86400),
          h: Math.floor((left % 86400) / 3600),
          m: Math.floor((left % 3600) / 60),
          s: left % 60,
        };
  const box = (v: number | undefined, unit: string) => (
    <span className={s.cdBox}>
      <b className="tnum">{v === undefined ? '--' : pad(v)}</b>
      <span>{unit}</span>
    </span>
  );
  return (
    <span className={s.countdown} role="timer" aria-label={label}>
      {parts && parts.d > 0 && box(parts.d, 'روز')}
      {box(parts?.h, 'ساعت')}
      {box(parts?.m, 'دقیقه')}
      {box(parts?.s, 'ثانیه')}
    </span>
  );
}
