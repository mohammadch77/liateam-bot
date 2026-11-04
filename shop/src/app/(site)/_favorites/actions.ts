'use server';

import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { runAction, type ActionResult } from '@/server/http/action';
import { favoriteService } from '@/server/services/favorite.service';

/** Favourite actions (Server Actions: same-origin checked). The browser sends a product code only; the owner is the session's user. */
const id = z.number().int().positive();

export async function favoritesStateAction(): Promise<ActionResult<{ signedIn: boolean; ids: number[] }>> {
  return runAction('favorite.state', () => favoriteService.state());
}

export async function setFavoriteAction(productId: number, on: boolean): Promise<ActionResult<{ on: boolean }>> {
  return runAction('favorite.set', async () => {
    const p = id.safeParse(productId);
    if (!p.success) throw new AppError('INVALID_DATA');
    return favoriteService.set(p.data, on === true);
  });
}
