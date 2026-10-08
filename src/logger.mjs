// JSON-lines logging to logs/sync.log (+ console). Alerts also go to logs/alerts.log
// so a future notifier (Telegram/email/NestJS webhook) only needs to hook `onAlert`.
import fs from 'node:fs';
import { config } from './config.mjs';

fs.mkdirSync('logs', { recursive: true });

// Defensive: never let credentials reach a log line.
const scrub = (s) => {
  let out = String(s);
  for (const secret of [config.password, config.username, process.env.TELEGRAM_BOT_TOKEN]) if (secret) out = out.split(secret).join('***');
  return out;
};

const alertHandlers = [];
export const onAlert = (fn) => alertHandlers.push(fn);

function write(level, msg, data) {
  const line = scrub(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }));
  fs.appendFileSync('logs/sync.log', line + '\n');
  if (level === 'ALERT') fs.appendFileSync('logs/alerts.log', line + '\n');
  (level === 'INFO' ? console.log : console.error)(`[${level}] ${scrub(msg)}${data ? ' ' + scrub(JSON.stringify(data)) : ''}`);
}

export const log = {
  info: (msg, data) => write('INFO', msg, data),
  warn: (msg, data) => write('WARN', msg, data),
  alert: (msg, data) => {
    write('ALERT', msg, data);
    for (const fn of alertHandlers) {
      try { fn(msg, data); } catch { /* notifier failure must not break sync */ }
    }
  },
};
