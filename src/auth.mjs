// Logs in with a real browser and saves Playwright storageState (lia-token cookie + localStorage).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config, requireCredentials } from './config.mjs';
import { log } from './logger.mjs';

export class AuthError extends Error {}

export async function login() {
  requireCredentials();
  log.info('Logging in to liateam.ir');
  // CHROMIUM_PATH: use a system Chromium (e.g. from apt) where Playwright's own download is blocked.
  const browser = await chromium.launch({ headless: !config.headful, executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const context = await browser.newContext({ locale: 'fa-IR' });
    const page = await context.newPage();
    // Wait until the page's scripts are running: clicking earlier makes the browser submit the form
    // natively as a GET, which puts username/password into the URL (and the site's analytics).
    await page.goto(config.signInUrl, { waitUntil: 'networkidle' });

    const user = page.locator('input[name="username"]');
    const pass = page.locator('input[type="password"]');
    try {
      await user.waitFor({ timeout: 15000 });
    } catch {
      throw new AuthError('Login form not found (input[name="username"]) - sign-in page structure changed?');
    }
    await user.fill(config.username);
    await pass.fill(config.password);

    const loginResponse = page.waitForResponse((r) => r.url().includes('/api/v1/client/login'), { timeout: 20000 });
    // Last guard against a native (non-JS) form submit leaking credentials into the URL.
    await page.evaluate(() => document.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault())));
    await page.locator('button[type="submit"]').first().click();
    const res = await loginResponse.catch(() => null);
    if (!res) throw new AuthError('No response from /api/v1/client/login (captcha/OTP or form changed?)');
    const body = await res.json().catch(() => ({}));
    if (res.status() !== 200 || body.success === false) {
      throw new AuthError(`Login rejected: HTTP ${res.status()} ${body.message ?? ''}`.trim());
    }
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 20000 }).catch(() => {});

    const state = await context.storageState();
    if (!state.cookies.some((c) => c.name === 'lia-token')) {
      throw new AuthError('Login finished but no lia-token cookie was set');
    }
    fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
    fs.writeFileSync(config.storageStatePath, JSON.stringify(state));
    log.info('Login OK, session saved');
  } finally {
    await browser.close();
  }
}

export const hasSession = () => fs.existsSync(config.storageStatePath);
