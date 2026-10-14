import { toAppError } from '@/lib/errors';
import { authorize } from '@/server/auth/guards';

export const dynamic = 'force-dynamic';

/** RBAC proof for APIs: 401 signed out, 403 without the admin role, 200 for admins. */
export async function GET() {
  try {
    const user = await authorize('admin');
    return Response.json(
      { ok: true, userId: user.id, roles: user.roles },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    const err = toAppError(e);
    return Response.json(err.toJSON(), { status: err.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
