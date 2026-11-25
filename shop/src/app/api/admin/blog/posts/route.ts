import { toAppError } from '@/lib/errors';
import { blogService, type BlogPostInput } from '@/server/services/blog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await blogService.adminBootstrap();
    return Response.json({ ok: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as BlogPostInput;
    const post = await blogService.adminCreatePost(body);
    return Response.json({ ok: true, post }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}
