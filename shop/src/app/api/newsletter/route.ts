/**
 * POST /api/newsletter — the footer's SMS newsletter form. Sign-ups are not taken yet: the request is answered
 * with 303 to the «به‌زودی» page and the submitted number is neither read nor stored.
 * Relative Location: behind nginx request.url carries the internal host (127.0.0.1:port).
 */
export function POST() {
  return new Response(null, {
    status: 303,
    headers: { Location: '/newsletter', 'Cache-Control': 'no-store' },
  });
}
