// Load test of the storefront (no dependency: Node's fetch with N parallel connections). Scenarios, mixed by weight:
// home, /shop with a price filter, a product page, the search page and search-as-you-type. Reports per scenario the
// request count, error rate and p50 / p95 / p99 latency, and checks them against the thresholds in docs/load-test.md
// (exit code 1 when one is exceeded).
//   npm run load-test -- http://127.0.0.1:3861 --duration 60 --connections 10
//   npm run load-test -- http://127.0.0.1:3861 --duration 30 --connections 25 --only home,product
// On the server, through an SSH tunnel to the shop itself (no TLS, no Basic Auth, no nginx):
//   ssh -p <port> -N -L 3861:127.0.0.1:3861 root@<server>
// Behind nginx with Basic Auth: --auth user:password (sent as an Authorization header, never in the URL).
// Read-only (GET requests only). Do not run it against production at busy hours.

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:3861').replace(/\/$/, '');
const duration = Number(flag('duration', '30')) * 1000;
const connections = Number(flag('connections', '10'));
const only = flag('only', '')?.split(',').filter(Boolean) ?? [];
const auth = flag('auth', '');
const headers = {
  'user-agent': 'shop-load-test',
  ...(auth ? { authorization: `Basic ${Buffer.from(auth).toString('base64')}` } : {}),
};

/** p95 limits (ms) and the error rate allowed; keep in step with docs/load-test.md */
export const THRESHOLDS = {
  home: { p95: 800, errors: 0.01 },
  shopPrice: { p95: 1000, errors: 0.01 },
  product: { p95: 800, errors: 0.01 },
  search: { p95: 1000, errors: 0.01 },
  suggest: { p95: 300, errors: 0.01 },
};

async function discover() {
  const html = await (await fetch(`${base}/`, { headers })).text();
  const products = [...html.matchAll(/href="(\/[a-z0-9]+(?:-[a-z0-9]+)*-\d+)"/g)].map((m) => m[1]);
  if (!products.length) throw new Error('no product link found on the home page');
  return [...new Set(products)].slice(0, 20);
}

const words = ['کرم', 'سرم', 'ریمل', 'شامپو', 'عطر', 'ضد آفتاب', 'رژ', 'ماسک'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function scenarios(products) {
  const all = {
    home: { weight: 3, url: () => '/' },
    shopPrice: {
      weight: 2,
      url: () => `/shop?min=${pick([0, 200000, 400000])}&max=${pick([800000, 1500000, 3000000])}`,
    },
    product: { weight: 4, url: () => pick(products) },
    search: { weight: 1, url: () => `/search?q=${encodeURIComponent(pick(words))}` },
    suggest: { weight: 3, url: () => `/api/search/suggest?q=${encodeURIComponent(pick(words))}` },
  };
  const chosen = Object.entries(all).filter(([k]) => !only.length || only.includes(k));
  const bag = chosen.flatMap(([k, s]) => Array(s.weight).fill(k));
  return { all, bag };
}

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

async function main() {
  const products = await discover();
  const { all, bag } = scenarios(products);
  const stats = Object.fromEntries(Object.keys(all).map((k) => [k, { times: [], errors: 0 }]));
  const until = Date.now() + duration;
  console.log(
    `load test: ${base}, ${connections} connections, ${duration / 1000}s, scenarios ${[...new Set(bag)].join(', ')}`,
  );

  const worker = async () => {
    while (Date.now() < until) {
      const name = pick(bag);
      const t0 = performance.now();
      try {
        const res = await fetch(base + all[name].url(), { headers, redirect: 'follow' });
        await res.arrayBuffer();
        if (!res.ok) stats[name].errors++;
      } catch {
        stats[name].errors++;
      }
      stats[name].times.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: connections }, worker));

  let failed = false;
  const rows = [];
  let total = 0;
  for (const [name, s] of Object.entries(stats)) {
    if (!s.times.length) continue;
    total += s.times.length;
    const sorted = [...s.times].sort((a, b) => a - b);
    const p95 = pct(sorted, 95);
    const errRate = s.errors / s.times.length;
    const limit = THRESHOLDS[name];
    const ok = p95 <= limit.p95 && errRate <= limit.errors;
    if (!ok) failed = true;
    rows.push({
      scenario: name,
      requests: s.times.length,
      'errors %': (errRate * 100).toFixed(2),
      'p50 ms': Math.round(pct(sorted, 50)),
      'p95 ms': Math.round(p95),
      'p99 ms': Math.round(pct(sorted, 99)),
      'limit p95': limit.p95,
      result: ok ? 'ok' : 'OVER',
    });
  }
  console.table(rows);
  console.log(`throughput: ${(total / (duration / 1000)).toFixed(1)} requests/s`);
  if (failed) {
    console.log('one or more scenarios over their threshold (docs/load-test.md)');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`load-test: ${e.message}`);
  process.exitCode = 2;
});
