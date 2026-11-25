import { toAppError } from '@/lib/errors';
import { blogService, type BlogPostInput } from '@/server/services/blog.service';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const post = await blogService.adminGetPost(id);
    return Response.json({ ok: true, post }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as BlogPostInput;
    const post = await blogService.adminUpdatePost(id, body);
    return Response.json({ ok: true, post }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await blogService.adminDeletePost(id);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}
