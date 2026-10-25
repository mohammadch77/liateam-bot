/**
 * Products live at the site root (/<slug>), next to the shop's own top-level pages. These first path segments
 * belong to the shop and can never be a product address. Every top-level folder of src/app (route groups
 * unwrapped) must be listed here — tests/unit/reserved-slugs.test.mjs checks that against the folders and against
 * every product slug in the database. Next.js serves a static segment before the dynamic [slug] anyway; this list
 * makes sure a product never gets an address that would be shadowed by one.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // pages
  'about',
  'account',
  'admin',
  'affiliate',
  'brands',
  'c',
  'cart',
  'categories',
  'checkout',
  'contact',
  'help',
  'legal',
  'login',
  'logout',
  'newsletter',
  'offers',
  'orders',
  'p', // the old product prefix: /p/… redirects permanently to /<slug>
  'packs',
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
