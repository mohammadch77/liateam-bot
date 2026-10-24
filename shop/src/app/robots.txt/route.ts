import { siteOrigin } from '@/server/http/site-origin';
import { indexingBlocked } from '@/server/seo-policy';

export const dynamic = 'force-dynamic';

/**
 * robots.txt: «Disallow: /» for every crawler while indexing is blocked (always outside production; in production the
 * admin's switch, default on); otherwise allow everything except the private parts, with the sitemap's address.
 */
export async function GET() {
  const body = (await indexingBlocked())
    ? 'User-agent: *\nDisallow: /\n'
    : [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /account',
        'Disallow: /api/',
        'Disallow: /cart',
        'Disallow: /login',
        '',
        `Sitemap: ${await siteOrigin()}/sitemap.xml`,
        '',
      ].join('\n');
  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
