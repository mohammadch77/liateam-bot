'use server';

import { authorize } from '@/server/auth/guards';
import { runAction, type ActionResult } from '@/server/http/action';
import { requestMeta } from '@/server/http/request';
import { reviewService } from '@/server/services/review.service';

export type ReviewState = ActionResult<{ status: 'pending' }> | null;

/** «ثبت دیدگاه»: signed-in users only; stored as pending until an admin approves it. */
export async function submitReviewAction(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  return runAction('review.submit', async () => {
    const user = await authorize();
    const { status } = await reviewService.submit(
      user,
      { productId: form.get('productId'), rating: form.get('rating'), body: String(form.get('body') ?? '') },
      await requestMeta(),
    );
    return { status };
  });
}
