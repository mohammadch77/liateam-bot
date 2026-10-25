'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authorize } from '@/server/auth/guards';
import { runAction } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { reviewService } from '@/server/services/review.service';

/** Approve or reject one pending site review (admins only; recorded in the audit log). */
export async function moderateReviewAction(form: FormData): Promise<void> {
  const decision = form.get('decision') === 'approve' ? 'approved' : 'rejected';
  const result = await runAction('review.moderate', async () => {
    const admin = await authorize('admin');
    return reviewService.moderate(admin, String(form.get('id') ?? ''), decision, await requestMeta());
  });
  if (result.ok) revalidatePath('/[slug]', 'page');
  redirect(`/admin/reviews?${result.ok ? 'done' : 'error'}=1`);
}
