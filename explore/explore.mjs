// Phase 1 – read-only exploration. Logs in (credentials from .env), then records
// network traffic while YOU browse to the product list / paginate in the headful window.
// Press ENTER in the terminal when done; a summary + raw captures are written to explore/output/.
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const { LIA_USERNAME, LIA_PASSWORD, LIA_LOGIN_URL = 'https://liateam.ir/' } = process.env;
if (!LIA_USERNAME || !LIA_PASSWORD) {
  console.error('Missing LIA_USERNAME / LIA_PASSWORD in .env');
  process.exit(1);
}

const OUT = path.resolve('explore/output');
fs.mkdirSync(path.join(OUT, 'bodies'), { recursive: true });

// Never write credentials to disk: scrub them from any captured text.
const scrub = (s) =>
  s == null ? s : String(s).split(LIA_PASSWORD).join('***').split(LIA_USERNAME).join('<user>');
const redactHeaders = (h) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) =>
    /authorization|cookie|token/i.test(k) ? [k, `<redacted len=${v.length}>`] : [k, scrub(v)]));

const log = [];
let n = 0;

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'fa-IR' });
const page = await context.newPage();

page.on('response', async (res) => {
  const req = res.request();
  const type = req.resourceType();
  if (!['xhr', 'fetch', 'document'].includes(type)) return;
  const url = res.url();
  const ct = res.headers()['content-type'] || '';
  const entry = {
    i: n++, method: req.method(), status: res.status(), type, url: scrub(url), contentType: ct,
    reqHeaders: redactHeaders(req.headers()), postData: req.postData() ? '<present, not stored>' : null,
    setCookie: res.headers()['set-cookie'] ? '<present>' : null,
  };
  try {
    const body = await res.text();
    entry.size = body.length;
    entry.isRsc = url.includes('_rsc=') || ct.includes('text/x-component');
    entry.looksLikeProducts = /price|قیمت|stock|موجودی|inventory|sku/i.test(body);
    const ext = ct.includes('json') ? 'json' : entry.isRsc ? 'rsc.txt' : ct.includes('html') ? 'html' : 'txt';
    const file = `${String(entry.i).padStart(4, '0')}.${ext}`;
    fs.writeFileSync(path.join(OUT, 'bodies', file), scrub(body));
    entry.bodyFile = file;
  } catch { entry.size = null; }
  log.push(entry);
});

console.log('Opening', LIA_LOGIN_URL);
await page.goto(LIA_LOGIN_URL, { waitUntil: 'domcontentloaded' });

// Best-effort auto-fill; if selectors don't match, finish login manually in the window.
try {
  const user = page.locator('input[type="tel"], input[name*="user" i], input[name*="mobile" i], input[name*="phone" i], input[type="email"], input[type="text"]').first();
  const pass = page.locator('input[type="password"]').first();
  await user.waitFor({ timeout: 8000 });
  await user.fill(LIA_USERNAME);
  if (await pass.count()) await pass.fill(LIA_PASSWORD);
  console.log('Credentials filled. Submit / finish login in the browser if needed.');
} catch {
  console.log('Login form not auto-detected — navigate to login and sign in manually in the window.');
}

console.log('\n>> Now browse to the product list (with price & stock), open 2–3 pages of pagination,');
console.log('>> maybe a category filter. Then press ENTER here to save the report.\n');
await new Promise((r) => readline.createInterface({ input: process.stdin }).once('line', r));

// Auth inspection (names/flags only, no values).
const cookies = (await context.cookies()).map((c) => ({
  name: c.name, domain: c.domain, httpOnly: c.httpOnly, secure: c.secure,
  expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session',
}));
const storage = await page.evaluate(() => ({
  localStorage: Object.keys(localStorage), sessionStorage: Object.keys(sessionStorage),
})).catch(() => ({}));
const trackers = await page.evaluate(() =>
  [...document.scripts].map((s) => s.src).filter((s) => /clarity|hotjar|analytics|gtag|yektanet|recaptcha|arcaptcha/i.test(s))
).catch(() => []);

fs.writeFileSync(path.join(OUT, 'network.json'), JSON.stringify(log, null, 2));
fs.writeFileSync(path.join(OUT, 'auth.json'), JSON.stringify({ cookies, storage, trackers, finalUrl: page.url() }, null, 2));
console.log(`Saved ${log.length} responses. Candidates with product-like data:`);
for (const e of log.filter((e) => e.looksLikeProducts))
  console.log(` #${e.i} ${e.method} ${e.status} ${e.isRsc ? '[RSC]' : ''} ${e.url.slice(0, 140)}`);
await browser.close();
