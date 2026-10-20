// Back off when Liateam pushes back (pure state machine; the state lives in bot_status 'backoff').
// `threshold` (default 3) blocked answers in a row — HTTP 429, 403, 5xx, or a captcha / challenge page — stop every
// task for 30 min; blocked again right after: 60, 120, then 240 min (the cap) each time. The first normal answer
// resets everything. Network errors (no answer) count as neither.

export const DEFAULT_BACKOFF = { threshold: 3, minutes: [30, 60, 120, 240] };
export const EMPTY = { consecutive: 0, level: 0, until: null, since: null, reason: null };

// a challenge / captcha page instead of Liateam's own payload (ArvanCloud and the usual providers)
const CHALLENGE = /captcha|recaptcha|hcaptcha|challenge-platform|cf-chl|__cf_chl|arvancloud.{0,200}(challenge|firewall|access denied)|verify you are human|ddos protection/i;

/** Is this answer Liateam (or its CDN) refusing us? */
export function isBlockedResponse(status, body = '') {
  if (status === 429 || status === 403 || (status >= 500 && status < 600)) return true;
  return typeof body === 'string' && body.length > 0 && CHALLENGE.test(body.slice(0, 20_000));
}

/** A blocked answer: counts it; at the threshold, starts (or extends) a backoff. */
export function onBlocked(state, now, reason, cfg = DEFAULT_BACKOFF) {
  const s = { ...EMPTY, ...state, consecutive: (state?.consecutive ?? 0) + 1, reason };
  if (s.consecutive < cfg.threshold) return { state: s, started: false };
  const minutes = cfg.minutes[Math.min(s.level, cfg.minutes.length - 1)];
  return {
    state: { ...s, consecutive: 0, level: s.level + 1, until: new Date(now.getTime() + minutes * 60_000).toISOString(), since: s.since ?? now.toISOString() },
    started: true,
    minutes,
  };
}

/** A normal answer: everything resets; `ended` = we were backing off (level > 0). */
export function onSuccess(state) {
  return { state: { ...EMPTY }, ended: (state?.level ?? 0) > 0 };
}

/** Still waiting? */
export const inBackoff = (state, now) => !!state?.until && new Date(state.until) > now;

/** Folds a run's answers (true = blocked, false = normal, in order) into the state; reports starts and the end. */
export function applyTrail(state, trail, now, cfg = DEFAULT_BACKOFF) {
  let s = { ...EMPTY, ...state };
  const started = [];
  let ended = false;
  for (const r of trail) {
    if (r.blocked) {
      const x = onBlocked(s, now, r.reason, cfg);
      s = x.state;
      if (x.started) started.push(x.minutes);
    } else {
      const x = onSuccess(s);
      ended ||= x.ended;
      s = x.state;
    }
  }
  return { state: s, started, ended };
}
