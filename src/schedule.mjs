// Scheduling helpers shared by the worker and the messenger.
/** Current hour in Tehran and whether it falls in the quiet window (e.g. "1-7"). */
export function inQuietHours(spec, now = new Date()) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(spec || '').trim());
  if (!m) return false;
  const [from, to] = [Number(m[1]), Number(m[2])];
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return from <= to ? h >= from && h < to : h >= from || h < to;
}
