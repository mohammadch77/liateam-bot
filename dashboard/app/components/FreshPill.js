import { ago } from '@/lib/format';

const CLS = { ok: 'b-ok', warn: 'b-warn', bad: 'b-bad' };
/** «داده‌ی ۴۸ دقیقه پیش به‌روز شد» – color by age relative to the schedule interval. */
export default function FreshPill({ health: h }) {
  return (
    <span className={`badge ${CLS[h.freshness]} fresh-pill`}>
      {h.lastGood ? <>داده‌ی <b>{ago(h.lastGood.started_at).replace(' پیش', '')}</b> پیش به‌روز شد</> : 'هنوز داده‌ی معتبری نیست'}
    </span>
  );
}
