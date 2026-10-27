// Crawlable header links: the main categories and the brands are plain <a href> in the server HTML of every page (no
// JavaScript, no menu opened), the same set on each page — search engines find every category and brand from anywhere.
// Read-only.
import { BASE, check, finish, sql } from './_harness.mjs';

const slug = sql(`select slug_en from product_catalog where id = 426`);
const pages = ['/', '/shop', '/shop/brands', `/shop/product/${slug}`];

const linksIn = (html, prefix) =>
  new Set(
    [...html.matchAll(new RegExp(`<a[^>]*href="(${prefix}[^"#?]+)"`, 'g'))].map((m) =>
      decodeURIComponent(m[1]),
    ),
  );

let first = null;
for (const path of pages) {
  const res = await fetch(`${BASE}${encodeURI(path)}`);
  const html = await res.text();
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const cats = linksIn(header, '/shop/category/');
  const brands = linksIn(header, '/shop/brand/');
  const name = path === `/shop/product/${slug}` ? 'product 426' : path;
  check(`${name}: 200`, res.ok, res.status);
  check(`${name}: header has category links in the HTML`, cats.size >= 5, cats.size);
  check(`${name}: header has brand links in the HTML`, brands.size >= 3, brands.size);
  const key = [...cats, '|', ...brands].sort().join(' ');
  if (first === null) first = key;
  else check(`${name}: the same links as on the home page`, key === first);
}
finish();
