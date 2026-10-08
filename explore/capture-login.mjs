// Shows the SHAPE of Liateam's login exchange so the bot can log in without a browser.
// Run on a machine where `npm run login` works:  node explore/capture-login.mjs
// Secrets are never printed: username/password/token values are masked; only keys, lengths and types are shown.
import { chromium } from 'playwright';
import { config, requireCredentials } from '../src/config.mjs';

requireCredentials();
const SECRETS = [config.username, config.password].filter(Boolean);
const mask = (s) => {
  let out = String(s ?? '');
  for (const x of SECRETS) out = out.split(x).join('<SECRET>');
  return out.replace(/[A-Za-z0-9_\-.]{24,}/g, (m) => `<long:${m.length}>`); // tokens / jwt
};
const shape = (v, d = 0) => {
  if (v === null) return null;
  if (Array.isArray(v)) return v.length ? [shape(v[0], d + 1)] : [];
  if (typeof v === 'object') return d > 3 ? '{…}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, d + 1)]));
  if (typeof v === 'string') return SECRETS.includes(v) ? '<SECRET>' : v.length > 24 ? `<string:${v.length}>` : mask(v);
  return typeof v;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'fa-IR' });
const page = await context.newPage();
page.on('request', (r) => {
  if (r.method() !== 'POST' || !/liateam/.test(r.url())) return;
  console.log('\n>>> REQUEST', r.method(), r.url());
  const h = r.headers();
  console.log('content-type:', h['content-type'], '| other headers:', Object.keys(h).filter((k) => !/cookie|user-agent|sec-|accept/.test(k)).join(', '));
  const body = r.postData();
  try { console.log('body shape:', JSON.stringify(shape(JSON.parse(body)))); } catch { console.log('body (masked):', mask(body)?.slice(0, 300)); }
});
page.on('response', async (r) => {
  if (r.request().method() !== 'POST' || !/liateam/.test(r.url())) return;
  console.log('<<< RESPONSE', r.status(), r.url());
  const sc = (await r.headersArray()).filter((x) => x.name.toLowerCase() === 'set-cookie').map((x) => x.value.split('=')[0]);
  console.log('set-cookie names:', sc.join(', ') || 'none');
  try { console.log('json shape:', JSON.stringify(shape(await r.json()))); } catch { console.log('(not json)'); }
});

await page.goto(config.signInUrl, { waitUntil: 'domcontentloaded' });
await page.locator('input[name="username"]').waitFor({ timeout: 15000 });
await page.locator('input[name="username"]').fill(config.username);
await page.locator('input[type="password"]').fill(config.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(6000);
const cookies = await context.cookies();
console.log('\n=== cookies after login:', cookies.map((c) => `${c.name} (domain ${c.domain}, httpOnly ${c.httpOnly}, expires ${c.expires > 0 ? new Date(c.expires * 1000).toISOString().slice(0, 10) : 'session'}, length ${c.value.length})`).join('\n  '));
const ls = await page.evaluate(() => Object.keys(localStorage));
console.log('=== localStorage keys:', ls.join(', ') || 'none');
await browser.close();
