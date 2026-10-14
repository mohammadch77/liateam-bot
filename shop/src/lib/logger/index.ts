/**
 * Minimal structured logger: one JSON line per event on stdout/stderr (journald collects it).
 * Values under secret-looking keys are masked, and connection strings are stripped of credentials.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|otp|database_?url|connection_?string/i;
const URL_CREDENTIALS = /(\w+:\/\/)[^:/@\s]+:[^@\s]+@/g;

function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.replace(URL_CREDENTIALS, '$1***@');
  if (value instanceof Error) {
    const out: Fields = { name: value.name, message: scrub(value.message) };
    if ('code' in value) out.code = (value as { code?: unknown }).code;
    if (value.cause !== undefined && depth < 3) out.cause = scrub(value.cause, depth + 1);
    if (process.env.NODE_ENV !== 'production') out.stack = value.stack;
    return out;
  }
  if (Array.isArray(value)) return depth < 4 ? value.map((v) => scrub(v, depth + 1)) : '[…]';
  if (value && typeof value === 'object') {
    if (depth >= 4) return '[…]';
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '***' : scrub(v, depth + 1)]),
    );
  }
  return value;
}

function write(level: Level, msg: string, fields?: Fields) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...(scrub(fields ?? {}) as Fields),
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Fields) => {
    if (process.env.LOG_LEVEL === 'debug') write('debug', msg, fields);
  },
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
