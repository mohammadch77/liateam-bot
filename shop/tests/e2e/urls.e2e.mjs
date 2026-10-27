// URL structure end to end (local app + Docker DB): products /shop/product/<slug>, categories /shop/category/<slug>,
// brands /shop/brand/<slug>, the other shop pages under /shop; every old address answers ONE 301 to the new one (query
// kept, no chain); canonical per page (?page=N self-canonical, filters/sort noindex); no internal link, JSON-LD item,
// sitemap or robots entry uses an old address. The sitemap/robots part needs indexing open, which only production does:
// the test starts a second app (port 3853, APP_ENV=production, indexing switch off) and restores the switch.
import { spawn } from 'node:child_process';
import { BASE, SCHEMA, check, finish, requireLocalApp, shopRoot, sleep, sql } from './_harness.mjs';

requireLocalApp();
const get = (path, init = {}) => fetch(BASE + path, { redirect: 'manual', ...init });
const text = async (path) => (await fetch(BASE + path)).text();
const canonicalOf = (html) => /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1] ?? null;
const pathOf = (u) => {
  const x = new URL(u, BASE);
  return decodeURIComponent(x.pathname) + x.search;
};
const OLD = /^\/(p|c|brands|categories|offers|search|packs)(\/|\?|$)/;
// root segments that are real pages of the shop (everything else at the root would be an old product address)
const PAGES = new Set([
  'about-us',
  'account',
  'admin',
  'affiliate',
  'cart',
  'checkout',
  'contact-us',
  'help',
  'legal',
  'login',
  'logout',
  'newsletter',
  'orders',
  'shop',
  'styleguide',
  'wishlist',
  'api',
  'fonts',
  'health',
]);
const oldLinks = (html) =>
  [...html.matchAll(/<a\b[^>]*\shref="(\/[^"#]*)"/g)]
    .map((m) => decodeURIComponent(m[1].replace(/&amp;/g, '&')))
    .filter((h) => {
      const first = h.split(/[/?]/)[1] ?? '';
      return (
        OLD.test(h) ||
        (first && !h.slice(1).includes('/') && !h.includes('?') && !PAGES.has(first) && !first.includes('.'))
      );
    });

// ── data to test with ──
const slug = sql(
  `select slug_en from product_catalog where id = 541 and is_sellable and price > 0 and missing_since is null and slug_en is not null`,
);
const shopHtml = await text('/shop');
const categoriesHtml = await text('/shop/categories');
const brandsHtml = await text('/shop/brands');
const catHref = decodeURIComponent(/href="(\/shop\/category\/[^"]+)"/.exec(categoriesHtml)?.[1] ?? '');
const brandHref = decodeURIComponent(/href="(\/shop\/brand\/[^"]+)"/.exec(brandsHtml)?.[1] ?? '');
check(
  '0 test data: a product, a category and a brand',
  !!slug && !!catHref && !!brandHref,
  `${slug} ${catHref} ${brandHref}`,
);
const productHref = `/shop/product/${slug}`;
const catCode = /-(\d+)$/.exec(catHref)?.[1] ?? /(\d+)$/.exec(catHref)?.[1];
check(
  '0b category address is Finglish-code: /shop/category/<a-z0-9->-<code>',
  /^\/shop\/category\/[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/.test(catHref),
  catHref,
);
const catFa = sql(`select name from categories where code = ${catCode}`)
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-|-$/g, '');
const brandSlug = brandHref.split('/').pop();

let redirects = 0;
try {
  // ── 1. old → new: one 301, query kept, and the target answers 200 itself (no chain) ──
  const fa = encodeURI(
    `541-${sql(`select name from product_catalog where id = 541`)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)}`,
  );
  const table = [
    [`/${slug}`, productHref],
    [`/p/${slug}`, productHref],
    [`/p/${fa}`, productHref],
    [`/${fa}`, productHref],
    ['/541', productHref],
    [`/c/${catCode}`, catHref],
    [encodeURI(`/c/${catCode}-${catFa}`), catHref],
    [encodeURI(`/categories/${catCode}-${catFa}`), catHref],
    [encodeURI(`/shop/category/${catCode}-${catFa}`), catHref], // the previous Persian address
    [`/shop/category/old-words-${catCode}`, catHref], // wrong or outdated words: found by the code alone
    ['/about', '/about-us'],
    ['/contact', '/contact-us'],
    [`/brands/${brandSlug}`, brandHref],
    ['/brands', '/shop/brands'],
    ['/categories', '/shop/categories'],
    ['/offers', '/shop/offers'],
    ['/search', '/shop/search'],
    ['/packs/skin-routine/oily', '/shop/packs/skin-routine/oily'],
  ];
  for (const [from, to] of table) {
    const r = await get(`${from}?sort=price_asc`);
    const loc = r.headers.get('location');
    const ok = r.status === 301 && loc !== null && pathOf(loc) === `${to}?sort=price_asc`;
    if (r.status === 301) redirects++;
    const next = ok ? await get(loc) : null;
    check(
      `1 ${decodeURIComponent(from)} → 301 ${to} (query kept)`,
      ok && next.status === 200,
      `${r.status} ${loc} → ${next?.status}`,
    );
  }
  check(
    '1b an unknown product at the root and a made-up /p/ address are real 404s',
    (await get('/no-such-page-xyz')).status === 404 &&
      (await get('/p/no-such-product-99999999')).status === 404,
  );
  check(
    '1c the new fixed pages answer 200 (not redirected)',
    (await get('/about-us')).status === 200 && (await get('/contact-us')).status === 200,
  );

  // ── 2. canonical of every page = its new address ──
  const pages = [
    ['product', productHref],
    ['category', catHref],
    ['brand', brandHref],
    ['shop', '/shop'],
    ['offers', '/shop/offers'],
    ['brands', '/shop/brands'],
    ['categories', '/shop/categories'],
    ['pack', '/shop/packs/skin-routine/oily'],
    ['about', '/about-us'],
    ['contact', '/contact-us'],
  ];
  const htmls = {};
  for (const [name, path] of pages) {
    const res = await fetch(BASE + encodeURI(path));
    const html = await res.text();
    htmls[name] = html;
    const c = canonicalOf(html);
    check(
      `2 ${name}: 200 and canonical = ${path}`,
      res.status === 200 && c !== null && pathOf(c) === path,
      `${res.status} ${c}`,
    );
  }

  // ── 3. paging and filters ──
  for (const [name, path] of [
    ['shop', '/shop'],
    ['category', catHref],
  ]) {
    const p2 = await text(`${encodeURI(path)}?page=2`);
    const c2 = canonicalOf(p2);
    check(
      `3a ${name} ?page=2: self-canonical (the staging app is noindex everywhere; production indexability is 7e)`,
      c2 !== null && pathOf(c2) === `${path}?page=2`,
      String(c2),
    );
    const f = await text(`${encodeURI(path)}?sort=newest&inStock=1`);
    const cf = canonicalOf(f);
    check(
      `3b ${name} sort+filter: noindex and canonical = the base page`,
      /<meta name="robots" content="[^"]*noindex/.test(f) && cf !== null && pathOf(cf) === path,
      String(cf),
    );
  }

  // ── 4. no internal link to an old address (a simple crawl of the main pages) ──
  const home = await text('/');
  for (const [name, html] of [
    ['home', home],
    ['shop', shopHtml],
    ['product', htmls.product],
    ['category', htmls.category],
    ['brand', htmls.brand],
    ['brands', htmls.brands],
    ['offers', htmls.offers],
  ]) {
    const bad = oldLinks(html);
    check(`4 ${name}: no <a href> to an old address`, bad.length === 0, bad.slice(0, 3).join(' '));
  }
  const crawled = new Set();
  for (const html of [home, shopHtml, htmls.category, htmls.brand]) {
    for (const m of html.matchAll(/<a\b[^>]*\shref="(\/shop\/(?:product|category|brand)\/[^"#?]+)"/g))
      crawled.add(m[1]);
  }
  let hops = 0;
  for (const href of [...crawled].slice(0, 40)) {
    const r = await get(href);
    if (r.status >= 300 && r.status < 400) hops++;
  }
  const nonLatin = [...crawled].filter(
    (h) => h.startsWith('/shop/category/') && !/^\/shop\/category\/[a-z0-9-]+$/.test(h),
  );
  check(
    '4c no crawled link to a Persian category address',
    nonLatin.length === 0,
    nonLatin.slice(0, 3).map(decodeURIComponent).join(' '),
  );
  check(
    `4b ${Math.min(crawled.size, 40)} product/category/brand links of the pages answer without a redirect`,
    crawled.size > 10 && hops === 0,
    `${crawled.size} links, ${hops} redirected`,
  );

  // ── 5. JSON-LD of the product: new addresses only ──
  const blocks = [
    ...htmls.product.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
  ].map((m) => JSON.parse(m[1]));
  const product = blocks.find((b) => b['@type'] === 'Product');
  const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
  check(
    '5a Product JSON-LD has url = the product address',
    product && pathOf(product.url) === productHref,
    product?.url,
  );
  check(
    '5b BreadcrumbList: home → category trail → product, all new addresses, the last is the product',
    crumbs &&
      crumbs.itemListElement.length >= 3 &&
      crumbs.itemListElement.every((i, n) => i.position === n + 1 && !OLD.test(pathOf(i.item))) &&
      pathOf(crumbs.itemListElement.at(-1).item) === productHref &&
      crumbs.itemListElement.slice(1, -1).every((i) => pathOf(i.item).startsWith('/shop/category/')),
    JSON.stringify(crumbs?.itemListElement?.map((i) => pathOf(i.item))),
  );
  const crumbLinks = [
    ...htmls.product.matchAll(/<nav[^>]*aria-label="[^"]*"[^>]*>([\s\S]*?)<\/nav>/g),
  ].flatMap((m) => [...m[1].matchAll(/href="([^"]+)"/g)].map((x) => decodeURIComponent(x[1])));
  check(
    '5c the visible breadcrumb links are new addresses',
    crumbLinks.length >= 2 && crumbLinks.every((h) => !OLD.test(h)),
    crumbLinks.join(' '),
  );

  // ── 6. the bot's revalidate call: its old names reach the new pages ──
  const secret = process.env.E2E_REVALIDATE_SECRET;
  if (secret) {
    const r = await fetch(`${BASE}/api/internal/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({
        paths: [
          { path: `/p/${slug}` },
          { path: '/c/[slug]', type: 'page' },
          { path: '/brands/[slug]', type: 'page' },
          { path: '/[slug]', type: 'page' },
          { path: '/shop' },
        ],
      }),
    });
    const body = await r.json().catch(() => ({}));
    check(
      '6 revalidate: /p/…, /c/[slug], /brands/[slug], /[slug] are translated to the /shop/… addresses',
      r.status === 200 &&
        body.revalidated?.slice(0, 4).join(' ') ===
          `${productHref} /shop/category/[slug] (page) /shop/brand/[slug] (page) /shop/product/[slug] (page)`,
      JSON.stringify(body.revalidated),
    );
  } else console.log('  – 6 skipped (E2E_REVALIDATE_SECRET not set)');
} finally {
  console.log(`  ${redirects} old addresses redirected (301) in this run`);
}

// ── 7. sitemap.xml and robots.txt: only the new addresses (second app in production mode, indexing open) ──
const PROD = 'http://127.0.0.1:3853';
const settingBefore = sql(`select value::text from ${SCHEMA}.site_settings where key = 'seo.block_indexing'`);
const child = spawn(
  process.execPath,
  [`${shopRoot}/node_modules/next/dist/bin/next`, 'start', '-H', '127.0.0.1', '-p', '3853'],
  {
    cwd: shopRoot,
    env: {
      ...process.env,
      APP_ENV: 'production',
      COOKIE_SECURE: '1',
      SMS_PROVIDER: 'kavenegar',
      KAVENEGAR_API_KEY: 'x',
      KAVENEGAR_OTP_TEMPLATE: 'x',
      TRUST_PROXY: '1',
    },
    stdio: 'ignore',
  },
);
try {
  sql(
    `insert into ${SCHEMA}.site_settings (key, value, updated_by, updated_at) values ('seo.block_indexing', 'false'::jsonb, null, now()) on conflict (key) do update set value = 'false'::jsonb`,
  );
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${PROD}/health`).then(
      (r) => r.status < 500,
      () => false,
    );
    if (!up) await sleep(1000);
  }
  check('7 the production-mode app started', up);
  if (up) {
    const xml = await (await fetch(`${PROD}/sitemap.xml`)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
      decodeURIComponent(new URL(m[1].replace(/&amp;/g, '&')).pathname),
    );
    const bad = locs.filter((p) => OLD.test(p) || (p !== '/' && !p.startsWith('/shop')));
    check(
      '7a sitemap.xml lists only new addresses (/, /shop, /shop/…)',
      locs.length > 50 && bad.length === 0,
      `${locs.length} urls; bad: ${bad.slice(0, 3).join(' ')}`,
    );
    check(
      '7b sitemap: the product, category and brand pages and the listings are in it',
      [productHref, '/shop', '/shop/offers', '/shop/brands', '/shop/categories'].every((p) =>
        locs.includes(p),
      ) &&
        locs.some((p) => p.startsWith('/shop/category/')) &&
        locs.some((p) => p.startsWith('/shop/brand/')),
    );
    check(
      '7c sitemap: every product address is /shop/product/<slug>',
      locs.filter((p) => p.startsWith('/shop/product/')).length > 50,
    );
    const robots = await (await fetch(`${PROD}/robots.txt`)).text();
    check(
      '7d robots.txt: sitemap line and no old address',
      /Sitemap: .*\/sitemap\.xml/.test(robots) &&
        !/Disallow: \/(p|c|brands|categories|offers|search|packs)\b/.test(robots),
      robots.replace(/\n/g, ' | '),
    );
    const page = await (await fetch(`${PROD}${productHref}`)).text();
    const prodPage2 = await (await fetch(`${PROD}/shop?page=2`)).text();
    const prodSorted = await (await fetch(`${PROD}/shop?sort=newest`)).text();
    check(
      '7f production: /shop?page=2 is indexable with its own canonical; /shop?sort=newest is noindex',
      !/noindex/.test(prodPage2) &&
        pathOf(canonicalOf(prodPage2) ?? '') === '/shop?page=2' &&
        /noindex/.test(prodSorted),
    );
    check(
      '7e production product page: canonical is the new address and it is indexable',
      pathOf(canonicalOf(page) ?? '') === productHref && !/noindex/.test(page),
    );
  }
} finally {
  child.kill();
  if (settingBefore)
    sql(
      `update ${SCHEMA}.site_settings set value = '${settingBefore}'::jsonb where key = 'seo.block_indexing'`,
    );
  else sql(`delete from ${SCHEMA}.site_settings where key = 'seo.block_indexing'`);
}

finish();
