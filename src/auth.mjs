// Logs in with a real browser and saves Playwright storageState (lia-token cookie + localStorage).
import fs from 'node:fs';
import path from 'node:path';
import { chromium, request } from 'playwright';
import { config, requireCredentials } from './config.mjs';
import { log } from './logger.mjs';

export class AuthError extends Error {}

/** Playwright storageState holding the lia-token cookie, as the site's own login would leave it. */
export function sessionState(token, expireAt) {
  const exp = Date.parse(expireAt);
  return {
    cookies: [{
      name: 'lia-token', value: token, domain: 'liateam.ir', path: '/',
      expires: Number.isFinite(exp) ? Math.floor(exp / 1000) : -1, httpOnly: true, secure: true, sameSite: 'Lax',
    }],
    origins: [],
  };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  fs.writeFileSync(config.storageStatePath + '.tmp', JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(config.storageStatePath + '.tmp', config.storageStatePath);
}

/**
 * Browserless login: POST /api/v1/client/login {username, password} -> {success, data: {token, expire_at}}.
 * The token is what the site stores in the lia-token cookie. Works where no browser can be installed.
 */
export async function apiLogin() {
  requireCredentials();
  const ctx = await request.newContext({
    baseURL: config.baseUrl,
    extraHTTPHeaders: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'Accept-Language': 'fa-IR,fa;q=0.9',
      Referer: config.signInUrl,
    },
  });
  try {
    const res = await ctx.post('/api/v1/client/login', { data: { username: config.username, password: config.password } });
    const body = await res.json().catch(() => ({}));
    const token = body?.data?.token;
    if (res.status() !== 200 || body.success === false || typeof token !== 'string' || !token) {
      // Never include the request or the token; the server message is safe (e.g. "wrong password").
      throw new AuthError(`Login rejected: HTTP ${res.status()} ${body.message ?? ''}`.trim());
    }
    saveState(sessionState(token, body.data.expire_at));
    log.info('Login OK (api), session saved', { expires: body.data.expire_at ?? 'unknown' });
  } finally {
    await ctx.dispose();
  }
}

/** API login first (no browser needed); falls back to the browser flow only if the API path fails. */
export async function login() {
  try {
    return await apiLogin();
  } catch (e) {
    if (e instanceof AuthError && /Login rejected: HTTP (200|401|403|422)/.test(e.message)) throw e; // real rejection: wrong credentials
    log.warn('API login failed, trying the browser', { reason: e.message });
  }
  return browserLogin();
}

async function browserLogin() {
  requireCredentials();
  log.info('Logging in to liateam.ir (browser)');
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
    saveState(state);
    log.info('Login OK (browser), session saved');
  } finally {
    await browser.close();
  }
}

export const hasSession = () => fs.existsSync(config.storageStatePath);
