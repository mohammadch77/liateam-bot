'use server';

import { redirect } from 'next/navigation';
import { runAction } from '@/server/http/action';
import { favoriteService } from '@/server/services/favorite.service';

/** «حذف از لیست» on the favourites page: takes one product off the signed-in customer's list (soft), then shows the list again. */
export async function removeFavoriteAction(form: FormData): Promise<void> {
  const id = Number(form.get('product'));
  await runAction('favorite.remove', () => favoriteService.set(id, false));
  redirect('/account/favorites');
}
