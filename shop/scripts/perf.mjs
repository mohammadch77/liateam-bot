// Lighthouse on the key pages of a running production build (npm run build && npm start), mobile (Lighthouse's
// default: mid-range phone, slow 4G, 4× CPU slowdown) and desktop, N runs each, the median printed as a table.
//   npm run perf                                  http://127.0.0.1:3850, 3 runs
//   npm run perf -- http://127.0.0.1:3852 --runs 5 --only mobile --out perf-after.json
//   npm run perf -- https://staging.example.ir     (the same against a real address)
// Chrome: Playwright's (installed once at the repo root for the sync bot), or CHROME_PATH.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import lighthouse, { desktopConfig } from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:3850').replace(/\/$/, '');
const runs = Number(opt('runs', 3));
const only = opt('only', 'both');
const out = opt('out', null);

// three product pages: the richest (video, many reviews), a typical one, a low-data one — by their English slugs
async function productPaths() {
  for (const f of ['.env.local', '.env']) if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));
  if (!process.env.DATABASE_URL) return ['/p/541'];
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(
    `SELECT '/p/' || slug_en AS p FROM product_catalog WHERE id = ANY($1) AND slug_en IS NOT NULL ORDER BY array_position($1, id)`,
    [[426, 160, 520]],
  );
  await c.end();
  return rows.map((r) => r.p);
}

const require = createRequire(new URL('../../package.json', import.meta.url));
const chromePath = process.env.CHROME_PATH || require('playwright').chromium.executablePath();
const pages = ['/', '/shop', '/c/173', ...(await productPaths()), '/offers', '/brands'];
const forms = only === 'both' ? ['mobile', 'desktop'] : [only];

const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox'] });
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const results = [];
try {
  for (const form of forms) {
    for (const p of pages) {
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const r = await lighthouse(
          base + p,
          { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] },
          form === 'desktop' ? desktopConfig : undefined,
        );
        const a = r.lhr.audits;
        const items = a['network-requests']?.details?.items ?? [];
        samples.push({
          score: Math.round((r.lhr.categories.performance.score ?? 0) * 100),
          lcp: a['largest-contentful-paint'].numericValue,
          cls: a['cumulative-layout-shift'].numericValue,
          tbt: a['total-blocking-time'].numericValue,
          fcp: a['first-contentful-paint'].numericValue,
          ttfb: a['server-response-time']?.numericValue ?? 0,
          kb: (a['total-byte-weight'].numericValue ?? 0) / 1024,
          requests: items.length,
          jsKb: items.filter((x) => x.resourceType === 'Script').reduce((n, x) => n + (x.transferSize ?? 0), 0) / 1024,
          lcpElement: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet?.slice(0, 80) ?? '',
        });
      }
      const m = (k) => median(samples.map((x) => x[k]));
      const row = {
        form,
        page: p.length > 34 ? p.slice(0, 31) + '…' : p,
        score: m('score'),
        lcp: Math.round(m('lcp')),
        cls: Number(m('cls').toFixed(3)),
        tbt: Math.round(m('tbt')),
        fcp: Math.round(m('fcp')),
        ttfb: Math.round(m('ttfb')),
        kb: Math.round(m('kb')),
        requests: m('requests'),
        jsKb: Math.round(m('jsKb')),
        lcpElement: samples[0].lcpElement,
      };
      results.push(row);
      console.log(
        `${form.padEnd(7)} ${row.page.padEnd(34)} score ${String(row.score).padStart(3)}  LCP ${String(row.lcp).padStart(5)}ms  CLS ${row.cls.toFixed(3)}  TBT ${String(row.tbt).padStart(4)}ms  FCP ${String(row.fcp).padStart(5)}ms  TTFB ${String(row.ttfb).padStart(4)}ms  ${String(row.kb).padStart(5)}KB  ${String(row.requests).padStart(3)} req  JS ${String(row.jsKb).padStart(4)}KB`,
      );
    }
  }
} finally {
  await chrome.kill();
}
if (out) fs.writeFileSync(out, JSON.stringify({ base, runs, at: new Date().toISOString(), results }, null, 2));
