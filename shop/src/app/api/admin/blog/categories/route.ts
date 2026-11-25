import { toAppError } from '@/lib/errors';
import { blogService } from '@/server/services/blog.service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await blogService.adminBootstrap();
    return Response.json({ ok: true, categories: data.categories }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      slug?: string;
      description?: string;
      sortOrder?: number;
      isActive?: boolean;
    };
    const category = await blogService.adminCreateCategory(body);
    return Response.json({ ok: true, category }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json({ ok: false, code: appErr.code, message: appErr.message }, { status: appErr.status });
  }
}
