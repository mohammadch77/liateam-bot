'use server';

import { redirect } from 'next/navigation';
import { clearSessionCookie, readSessionCookie } from '@/server/auth/cookie';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { authService } from '@/server/services/auth.service';

/** Revokes the session in the database (not just the cookie), so a copied cookie stops working too. */
export async function logoutAction(): Promise<void> {
  const result = await runAction('auth.logout', async () => {
    const token = await readSessionCookie();
    if (token) await authService.logout(token, await requestMeta());
    await clearSessionCookie();
  });
  if (!result.ok) redirect('/account?error=logout');
  redirect('/login');
}
