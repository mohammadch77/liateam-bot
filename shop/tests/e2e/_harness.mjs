// Shared setup for the end-to-end tests (see README «تست‌های end-to-end»).
//
//   E2E_BASE_URL     the running app (default http://127.0.0.1:$PORT, PORT from .env.local, else 3850)
//   E2E_SERVER_LOG   file the app's stdout is written to — auth and product tests (dev-SMS codes are read from it)
//   E2E_SCREENSHOTS  folder for screenshots (optional; none are taken without it)
//
// Playwright comes from the repository root (`npm ci` there, once: `npx playwright install chromium`).
// Tests that read or change the database (auth, catalog) go through the local Docker Postgres of the repo root
// (docker-compose.yml) and refuse to run against any app that is not on this machine: they change rows (prices,
// stock, OTP timestamps) and must never touch a real database.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const shopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const repoRoot = path.resolve(shopRoot, '..');
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(shopRoot, f))) process.loadEnvFile(path.join(shopRoot, f));

const require = createRequire(path.join(repoRoot, 'package.json'));
export const { chromium, webkit, devices } = require('playwright');

export const BASE = (process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3850}`).replace(
  /\/$/,
  '',
);
export const SCHEMA = process.env.DB_SCHEMA ?? 'shop_staging';
export const SHOTS = process.env.E2E_SCREENSHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
export const shot = (page, name, opts = {}) =>
  SHOTS ? page.screenshot({ path: path.join(SHOTS, name), ...opts }) : Promise.resolve();

/** Local-only guard for tests that write to the database. */
export function requireLocalApp() {
  const host = new URL(BASE).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    console.error(`refused: this test changes database rows and only runs against a local app (got ${BASE})`);
    process.exit(2);
  }
}

/** One SQL statement on the local Docker database (psql -tA output, trimmed). */
export function sql(q) {
  return execFileSync(
    'docker',
    [
      'compose',
      '-f',
      path.join(repoRoot, 'docker-compose.yml'),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'lia',
      'lia_sync',
      '-tAc',
      q,
    ],
    { encoding: 'utf8' },
  ).trim();
}

const results = [];
export function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}
/** Prints «n/m passed» and sets the exit code (not process.exit: open sockets crash Node on Windows). */
export function finish() {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 1234 → «۱٬۲۳۴» (how the shop formats numbers). */
export const fa = (n) => new Intl.NumberFormat('fa-IR').format(n);
/** «۱٬۲۳۴ تومان» → 1234 */
export const toLatin = (s) => s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9]/g, '');

/**
 * Signs a fresh user in through the real login form (phone → dev-SMS code read from E2E_SERVER_LOG).
 * Exits with code 2 when the log is not set, like the auth test.
 */
export async function signIn(page, phone) {
  const log = process.env.E2E_SERVER_LOG;
  if (!log || !fs.existsSync(log)) {
    console.error(
      'set E2E_SERVER_LOG to the file the app writes its output to (dev SMS codes are read from it)',
    );
    process.exit(2);
  }
  const masked = `${phone.slice(0, 4)}•••${phone.slice(-4)}`;
  await page.goto(`${BASE}/login`);
  await page.locator('main').getByLabel('شماره موبایل').fill(phone);
  await page.getByRole('button', { name: 'دریافت کد تأیید' }).click();
  let code = null;
  for (let i = 0; i < 40 && !code; i++) {
    const last = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.includes('sms.dev.otp') && l.includes(masked))
      .at(-1);
    if (last) code = JSON.parse(last.slice(last.indexOf('{'))).devCode;
    else await sleep(300);
  }
  if (!code) throw new Error('no dev-SMS code in the log for ' + masked);
  await page.getByRole('textbox', { name: 'کد تأیید', exact: true }).fill(code);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    page.getByRole('button', { name: 'ورود', exact: true }).click(),
  ]);
}
