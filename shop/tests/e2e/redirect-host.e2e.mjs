// Redirects behind nginx: the app listens on an internal host:port, so a Location built from request.url would send the visitor to
// localhost. /r/<code> answers a relative Location; the old-address 301 (proxy layer, which needs an absolute one) uses the public host. The referral cookie still comes with the link of a real code (affiliate-panel checks the
// thirty days and the sign-up).
import { BASE, SCHEMA as S, check, finish, requireLocalApp, sql } from './_harness.mjs';
import { dropCaches, enablePayment } from './_pay.mjs';

requireLocalApp();
const NGINX = { host: 'shop.example.test', 'x-forwarded-host': 'shop.example.test', 'x-forwarded-proto': 'https' };
const get = (path, headers = {}) => fetch(BASE + path, { redirect: 'manual', headers });
const internal = (loc) => /(localhost|127\.0\.0\.1|\[::1\]|:\d{4,5}\b)/.test(loc ?? '');

for (const [name, path] of [
  ['1a the referral link (unknown code)', '/r/zzzzzzzz'],
  ['1b the referral link (odd code)', '/r/%20x'],
]) {
  for (const [label, headers] of [['plain', {}], ['nginx headers', NGINX]]) {
    const r = await get(path, headers);
    const loc = r.headers.get('location');
    check(`${name}, ${label}: 303 to a relative "/" and never localhost / 127.0.0.1 / a port`, r.status === 303 && loc === '/' && !internal(loc), `${r.status} ${loc}`);
  }
}

// the proxy layer needs an absolute Location: site.base_url when set, else the forwarded host; never the internal address
const old = async () => {
  const r = await get('/brands?sort=price_asc', NGINX);
  return [r.status, r.headers.get('location')];
};
const restore = await enablePayment({ 'site.base_url': 'https://base.example.test' });
try {
  const [st, loc] = await old();
  check('2a an old address with site.base_url set: 301 to that public address, query kept', st === 301 && loc === 'https://base.example.test/shop/brands?sort=price_asc', `${st} ${loc}`);
  sql(`delete from ${S}.site_settings where key = 'site.base_url'`);
  await dropCaches();
  const [st2, loc2] = await old();
  check('2b without site.base_url: 301 to the forwarded host (not localhost / 127.0.0.1 / a port), query kept', st2 === 301 && loc2 === 'https://shop.example.test/shop/brands?sort=price_asc' && !internal(loc2), `${st2} ${loc2}`);
} finally {
  await restore();
}
finish();
