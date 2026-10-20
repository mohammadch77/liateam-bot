// Safety rules for the sync schedule settings — the one definition of what the dashboard, the bots and the bot's
// own settings reader accept. Pure (no imports). An identical copy lives in dashboard/lib/scheduleRules.mjs (the
// dashboard cannot import from outside its folder); test/schedule-rules.test.mjs runs the same cases on both.
//
// Minimum intervals (env, same names in the bot's and the dashboard's .env): too short and Liateam may block the
// account. Windows: day and evening are set by three times (day start, day end = evening start, evening end =
// night start); the night is the rest and always sleeps. The times must go round the clock in that order, so the
// windows can neither overlap nor leave a hole, and the night can never disappear.

export const HELP_FA = 'فاصله‌ی خیلی کم ممکن است باعث مسدود شدن حساب شما در لیاتیم شود.';
export const TASK_FA = { catalog: 'قیمت و موجودی', hero: 'بنرها', details: 'محتوای سنگین' };
export const MAX_MINUTES = 1440;
export const MIN_WINDOW_MINUTES = 30; // day and evening
export const MIN_NIGHT_MINUTES = 60;

/** Minimum minutes per task: SYNC_MIN_CATALOG_MINUTES (30), SYNC_MIN_HERO_MINUTES (15), SYNC_MIN_DETAILS_MINUTES (60). */
export function minimums(env = {}) {
  const read = (name, fallback) => {
    const v = Number(env[name]);
    return Number.isInteger(v) && v >= 1 && v <= MAX_MINUTES ? v : fallback;
  };
  return {
    catalog: read('SYNC_MIN_CATALOG_MINUTES', 30),
    hero: read('SYNC_MIN_HERO_MINUTES', 15),
    details: read('SYNC_MIN_DETAILS_MINUTES', 60),
  };
}

const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);

/** null = fine, else the Persian reason. */
export function checkInterval(task, minutes, env = {}) {
  const min = minimums(env)[task];
  if (min == null) return 'وظیفه‌ی ناشناخته';
  if (!Number.isInteger(minutes)) return `فاصله‌ی «${TASK_FA[task]}» باید یک عدد صحیح (دقیقه) باشد`;
  if (minutes < min) return `فاصله‌ی «${TASK_FA[task]}» نمی‌تواند کمتر از ${fa(min)} دقیقه باشد. ${HELP_FA}`;
  if (minutes > MAX_MINUTES) return `فاصله‌ی «${TASK_FA[task]}» حداکثر ${fa(MAX_MINUTES)} دقیقه (۲۴ ساعت) است`;
  return null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const span = (from, to) => (toMin(to) - toMin(from) + 1440) % 1440;

/**
 * The three times {day_start, evening_start, night_start} → null when they make day → evening → night → day round
 * the clock with every window long enough, else the Persian reason.
 */
export function checkWindows({ day_start: d, evening_start: e, night_start: n }) {
  for (const [t, label] of [[d, 'شروع روز'], [e, 'پایان روز / شروع عصر'], [n, 'پایان عصر / شروع شب']]) {
    if (typeof t !== 'string' || !TIME.test(t)) return `«${label}» را به شکل ۰۷:۰۰ بنویسید`;
  }
  const day = span(d, e), evening = span(e, n), night = span(n, d);
  // in order round the clock: the three parts add up to exactly one day (otherwise two windows overlap)
  if (day + evening + night !== 1440 || day === 0 || evening === 0 || night === 0) {
    return 'پنجره‌ها باید به ترتیب روز ← عصر ← شب پشت سر هم بیایند، بدون هم‌پوشانی و بدون فاصله';
  }
  if (day < MIN_WINDOW_MINUTES || evening < MIN_WINDOW_MINUTES) return `روز و عصر هر کدام حداقل ${fa(MIN_WINDOW_MINUTES)} دقیقه‌اند`;
  if (night < MIN_NIGHT_MINUTES) return `خواب شبانه حذف نمی‌شود؛ حداقل ${fa(MIN_NIGHT_MINUTES)} دقیقه`;
  return null;
}

/** sync_settings keys of a per-window interval: day_catalog_minutes … evening_details_minutes → [window, task]. */
export function intervalKey(key) {
  const m = /^(day|evening)_(catalog|hero|details)_minutes$/.exec(key);
  return m ? [m[1], m[2]] : null;
}
