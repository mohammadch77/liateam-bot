import { toAppError } from '@/lib/errors';
import { blogService } from '@/server/services/blog.service';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      slug?: string;
      description?: string;
      sortOrder?: number;
      isActive?: boolean;
    };
    const category = await blogService.adminUpdateCategory(id, body);
    return Response.json({ ok: true, category }, { headers: { 'Cache-Control': 'no-store' } });
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
    await blogService.adminDeleteCategory(id);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}
