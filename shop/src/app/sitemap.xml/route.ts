import { siteOrigin } from '@/server/http/site-origin';
import { indexingBlocked } from '@/server/seo-policy';
import { catalogService } from '@/server/services/catalog.service';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * sitemap.xml: 404 while indexing is blocked (outside production always; in production the admin's switch);
 * otherwise every public page — home, shop, offers, brands, categories, each category, brand and product.
 */
export async function GET() {
  if (await indexingBlocked()) return new Response('not found', { status: 404 });
  const origin = await siteOrigin();
  const urls = (await catalogService.sitemapEntries()).map(
    ({ path, lastModified }) =>
      `<url><loc>${esc(origin + encodeURI(path))}</loc>${lastModified ? `<lastmod>${lastModified.toISOString()}</lastmod>` : ''}</url>`,
  );
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    },
  );
}
