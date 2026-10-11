// Phase 1 (orders) – records the network traffic of one order placed BY HAND in a headful browser,
// from adding to the basket up to (not including) payment. Nothing is automated: you click, it records.
//
//   node explore/capture-order.mjs
//
// Safety:
// - Requests to bank gateways (Shaparak / PSP domains) are blocked, so a payment cannot start from
//   this window even by accident. Stop at the payment page.
// - Uses the saved session (.auth/state.json); if it has expired, log in by hand in the window.
// - Credentials, tokens and cookies are masked before anything is written to disk. Output stays in
//   explore/output/ (gitignored) because it contains the test address/phone you enter.
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(`explore/output/order-${stamp}`);
fs.mkdirSync(path.join(OUT, 'bodies'), { recursive: true });

const secrets = [process.env.LIA_PASSWORD, process.env.LIA_USERNAME].filter(Boolean);
const scrub = (s) => {
  if (s == null) return s;
  let out = String(s);
  for (const x of secrets) out = out.split(x).join('***');
  // Token-looking values in JSON bodies (e.g. {"token":"..."}).
  return out.replace(/("(?:token|access_token|refresh_token|lia-token|password)"\s*:\s*")[^"]*"/gi, '$1***"');
};
const redactHeaders = (h) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) =>
    /authorization|cookie|token/i.test(k) ? [k, `<redacted len=${v.length}>`] : [k, scrub(v)]));

// Payment gateways: block outright.
const GATEWAY = /shaparak|sep\.ir|asanpardakht|behpardakht|pec\.ir|sadadpsp|zarinpal|idpay|payping|nextpay|pna\.co\.ir|ipg|bitpay|vandar|zibal|irankish|sizpay/i;

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  locale: 'fa-IR',
  storageState: fs.existsSync('.auth/state.json') ? '.auth/state.json' : undefined,
});
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (GATEWAY.test(new URL(url).hostname)) {
    console.log(`\n🛑 BLOCKED payment gateway request: ${new URL(url).hostname} – stop here, the capture is complete.\n`);
    log.push({ i: n++, blocked: true, method: route.request().method(), url: scrub(url),
      pageUrl: scrub(route.request().frame()?.url?.() ?? ''), requestBody: scrub(route.request().postData()) });
    return route.abort();
  }
  return route.continue();
});

const log = [];
let n = 0;
const page = await context.newPage();

context.on('response', async (res) => {
  const req = res.request();
  if (!['xhr', 'fetch', 'document'].includes(req.resourceType())) return;
  const url = res.url();
  if (!/liateam/.test(new URL(url).hostname)) return; // supplier only (skip analytics/chat widgets)
  const ct = res.headers()['content-type'] || '';
  const entry = {
    i: n++, at: new Date().toISOString(), method: req.method(), status: res.status(), type: req.resourceType(),
    url: scrub(url), pageUrl: scrub(page.url()), contentType: ct,
    reqHeaders: redactHeaders(req.headers()),
    requestBody: scrub(req.postData()),
    location: res.headers().location ?? null,
  };
  try {
    const body = await res.text();
    entry.size = body.length;
    entry.isRsc = url.includes('_rsc') || ct.includes('text/x-component');
    const ext = ct.includes('json') ? 'json' : entry.isRsc ? 'rsc.txt' : ct.includes('html') ? 'html' : 'txt';
    const file = `${String(entry.i).padStart(4, '0')}.${ext}`;
    fs.writeFileSync(path.join(OUT, 'bodies', file), scrub(body));
    entry.bodyFile = file;
  } catch { entry.size = null; }
  log.push(entry);
  if (req.method() !== 'GET') console.log(`  ${req.method()} ${res.status()} ${new URL(url).pathname}`);
});

// `node explore/capture-order.mjs address` – record deleting a saved address instead of an order.
const addressMode = process.argv[2] === 'address';
await page.goto(addressMode ? 'https://liateam.ir/dashboard' : 'https://liateam.ir/categories', { waitUntil: 'domcontentloaded' });

if (addressMode) console.log(`
──────────────────────────────────────────────────────────────
In the browser window, BY HAND:
  1. Open the panel's addresses page ("آدرس‌های من" in the dashboard menu).
  2. Delete ONE of the test addresses added during the order tests
     (not your default address). Confirm the delete dialog.
  3. If there is an "edit address" option, open it once and save without changes.
Then press ENTER here.
──────────────────────────────────────────────────────────────`);
else console.log(`
──────────────────────────────────────────────────────────────
In the browser window, place a real order BY HAND:
  1. Add ONE cheap product to the basket.
  2. Open the basket and go to checkout.
  3. Choose an existing delivery address (no new one needed this time).
  4. Choose a shipping method and a bank.
  5. Click the PAY button. The order request to Liateam is recorded;
     the jump to the bank is BLOCKED here, so nothing is paid.
  6. Open the panel's orders page ("سفارش‌های من") and open that order once.
Then press ENTER here.
──────────────────────────────────────────────────────────────`);
await new Promise((r) => readline.createInterface({ input: process.stdin }).once('line', r));

fs.writeFileSync(path.join(OUT, 'network.json'), JSON.stringify(log, null, 2));
const storage = await page.evaluate(() => ({
  localStorage: Object.fromEntries(Object.keys(localStorage).filter((k) => /basket|cart|order|address/i.test(k)).map((k) => [k, localStorage.getItem(k)])),
})).catch(() => ({}));
fs.writeFileSync(path.join(OUT, 'storage.json'), scrub(JSON.stringify(storage, null, 2)));

console.log(`\nSaved ${log.length} requests to ${OUT}`);
console.log('Non-GET requests (the interesting ones):');
for (const e of log.filter((e) => e.method !== 'GET')) console.log(` #${e.i} ${e.method} ${e.status ?? 'BLOCKED'} ${e.url.slice(0, 120)}`);
await browser.close();
