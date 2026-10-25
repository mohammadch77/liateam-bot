// POST /api/internal/revalidate (the sync bot refreshes the pages of changed products): refused without the shared
// secret or with a wrong one, refuses bad bodies, and with the secret revalidates exactly the paths it was given
// (known route patterns only with a type). Needs the app started with REVALIDATE_SECRET and the same value in
// E2E_REVALIDATE_SECRET. Read-only.
import { BASE, check, finish } from './_harness.mjs';

const secret = process.env.E2E_REVALIDATE_SECRET;
if (!secret) {
  console.error("set E2E_REVALIDATE_SECRET (= the app's REVALIDATE_SECRET) to run this test");
  process.exit(2);
}
const url = `${BASE}/api/internal/revalidate`;
const post = (body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const paths = {
  paths: [
    { path: '/p/serge-riml-abro-mshki-srzhe-541' },
    { path: '/' },
    { path: '/c/[slug]', type: 'page' },
    { path: '/x/[id]', type: 'page' },
  ],
};

let res = await post(paths);
check('1 no secret → 401, nothing revalidated', res.status === 401, String(res.status));
res = await post(paths, { 'x-revalidate-secret': 'wrong'.padEnd(64, 'x') });
check('2 wrong secret → 401', res.status === 401, String(res.status));
res = await post(paths, { 'x-revalidate-secret': secret.slice(0, -1) });
check('3 secret one character short → 401', res.status === 401, String(res.status));

res = await post(paths, { 'x-revalidate-secret': secret });
const body = await res.json().catch(() => ({}));
check(
  '4 with the secret → 200, exactly the given paths revalidated (unknown pattern ignored)',
  res.status === 200 &&
    JSON.stringify(body.revalidated) ===
      JSON.stringify(['/serge-riml-abro-mshki-srzhe-541', '/', '/c/[slug] (page)']), // the bot's /p/… → /<slug>
  JSON.stringify(body.revalidated),
);
res = await post({ paths: [{ path: 'https://evil.example/' }] }, { 'x-revalidate-secret': secret });
check('5 not a path of the shop → 400', res.status === 400, String(res.status));
res = await post({ nope: 1 }, { 'x-revalidate-secret': secret });
check('6 bad body → 400', res.status === 400, String(res.status));
res = await post({ paths: [{ path: '/shop' }] }, { 'x-revalidate-secret': secret });
const listings = (await res.json().catch(() => ({}))).revalidated ?? [];
check(
  '8 a listing change also refreshes offers, the overviews and the pack pages',
  ['/offers', '/categories', '/brands', '/packs/[collection]/[variant] (page)'].every((x) =>
    listings.includes(x),
  ),
  JSON.stringify(listings),
);
res = await fetch(url);
check('7 GET is not allowed', res.status === 405, String(res.status));
finish();
