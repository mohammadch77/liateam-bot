import { toAppError } from '@/lib/errors';
import { authorize } from '@/server/auth/guards';
import { saveBlogImageUpload } from '@/server/blog/media';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await authorize('admin');
    const form = await request.formData();
    const raw = form.get('file');
    if (!(raw instanceof File)) {
      return Response.json({ ok: false, message: 'فایل تصویر ارسال نشده است.' }, { status: 422 });
    }
    const saved = await saveBlogImageUpload(raw);
    return Response.json({ ok: true, ...saved }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const appErr = toAppError(err);
    return Response.json(
      { ok: false, code: appErr.code, message: appErr.message },
      { status: appErr.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
