import 'server-only';
import { AppError } from '@/lib/errors';
import { authorize } from '@/server/auth/guards';
import { rateLimit } from '@/server/http/rate-limit';
import { favoriteRepository, MAX_FAVORITES } from '@/server/repositories/favorite.repository';
import { catalogService, type ProductView } from './catalog.service';
import { getCurrentUser } from './session.service';

/**
 * The favourites list. A guest has none (the hearts send them to the sign-in); a signed-in customer reads and changes only their own
 * rows (the user comes from the session, the browser sends a product code only).
 */
export const favoriteService = {
  /** For the hearts: is someone signed in, and which products are on their list. Cheap; never throws for a guest. */
  async state(): Promise<{ signedIn: boolean; ids: number[] }> {
    const user = await getCurrentUser();
    if (!user) return { signedIn: false, ids: [] };
    return { signedIn: true, ids: await favoriteRepository.ids(user.id) };
  },

  /** A heart clicked: on or off. A product that is not in the shop cannot be added. */
  async set(productId: number, on: boolean): Promise<{ on: boolean }> {
    const user = await authorize();
    rateLimit(`favorite:${user.id}`, 60, 60_000);
    if (!Number.isInteger(productId) || productId <= 0) throw new AppError('INVALID_DATA');
    if (!on) {
      await favoriteRepository.remove(user.id, productId);
      return { on: false };
    }
    if (!(await catalogService.productViews([productId])).has(productId))
      throw new AppError('INVALID_REFERENCE', { message: 'این کالا در فروشگاه موجود نیست.' });
    if ((await favoriteRepository.count(user.id)) >= MAX_FAVORITES)
      throw new AppError('INVALID_DATA', { message: 'فهرست علاقه‌مندی‌ها پر است؛ ابتدا چند کالا را حذف کنید.' });
    await favoriteRepository.add(user.id, productId);
    return { on: true };
  },

  /**
   * The /account/favorites page: the products of the list as the catalog shows them now (price, stock, discount). A product that is no
   * longer displayable is left out of the cards and only counted, so the page can say so.
   */
  async list(userId: string): Promise<{ products: ProductView[]; hidden: number }> {
    const ids = await favoriteRepository.ids(userId);
    const views = await catalogService.productViews(ids);
    const products = ids.flatMap((id) => {
      const v = views.get(id);
      return v ? [v] : [];
    });
    return { products, hidden: ids.length - products.length };
  },
};
