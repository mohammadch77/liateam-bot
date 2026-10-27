/**
 * Products now live at /shop/product/<slug>; the old root address /<slug> only redirects there (src/proxy.ts via
 * legacyRoute in src/lib/urls.ts). These first path segments belong to the shop itself — its pages, its old section
 * prefixes (/p, /c, /brands, … which redirect under /shop) and its files — and are never looked up as a product.
 * Every top-level folder of src/app (route groups unwrapped) must be listed here — tests/unit/reserved-slugs.test.ts
 * checks that against the folders and against every product slug in the database.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // pages
  'about', // old address: redirects to /about-us
  'about-us',
  'account',
  'admin',
  'affiliate',
  'brands',
  'c',
  'cart',
  'categories',
  'brand',
  'category',
  'checkout',
  'contact', // old address: redirects to /contact-us
  'contact-us',
  'faq',
  'help',
  'legal',
  'login',
  'logout',
  'newsletter',
  'offers',
  'orders',
  'p', // the old product prefix: /p/… redirects permanently to /shop/product/<slug>
  'packs',
  'product',
  'register',
  'search',
  'shop',
  'styleguide',
  'wishlist',
  // endpoints and files
  'api',
  'fonts',
  'health',
  'robots.txt',
  'sitemap.xml',
  'favicon.ico',
  '_next',
]);

export const isReservedSlug = (segment: string) => RESERVED_SLUGS.has(segment.toLowerCase());
