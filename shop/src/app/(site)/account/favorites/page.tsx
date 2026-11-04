import type { Metadata } from 'next';
import { toFaDigits } from '@/lib/format/number';
import { requireUser } from '@/server/auth/guards';
import { favoriteService } from '@/server/services/favorite.service';
import { Alert, Breadcrumb, Button, EmptyState, ProductCard, ProductGrid } from '@/ui';
import s from '../account.module.css';
import { removeFavoriteAction } from './actions';

export const metadata: Metadata = { title: 'علاقه‌مندی‌ها', robots: { index: false } };

/**
 * The customer's favourites: the products as the catalog shows them now (price and stock from the same logic as the shop), each with
 * the card's own «افزودن به سبد» button, an out-of-stock one with its message, and «حذف از لیست». Only the signed-in customer's own list.
 */
export default async function FavoritesPage() {
  const user = await requireUser('/account/favorites');
  const data = await favoriteService.list(user.id).catch(() => null);
  return (
    <>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'حساب کاربری', href: '/account' }, { label: 'علاقه‌مندی‌ها' }]} />
      <h1 className={s.title}>علاقه‌مندی‌ها</h1>
      {!data ? (
        <EmptyState icon="error" tone="danger" title="فهرست بارگذاری نشد">
          چند لحظه بعد دوباره تلاش کنید.
        </EmptyState>
      ) : data.products.length === 0 ? (
        <EmptyState
          icon="favorite"
          title="فهرست علاقه‌مندی‌های شما خالی است"
          action={<Button href="/shop">دیدن محصولات</Button>}
        >
          روی قلب هر محصول بزنید تا اینجا نگهش داریم.
        </EmptyState>
      ) : (
        <>
          <p className={s.muted} data-favorites-count>
            {toFaDigits(data.products.length)} کالا در فهرست شماست.
          </p>
          {data.hidden > 0 && (
            <Alert tone="warning">
              <span data-favorites-hidden>{toFaDigits(data.hidden)} کالای فهرست شما دیگر در فروشگاه عرضه نمی‌شود.</span>
            </Alert>
          )}
          <ProductGrid>
            {data.products.map((p) => (
              <div key={p.id} data-favorite-item={p.id}>
                <ProductCard product={p} />
                {p.stock === 'out' && (
                  <p className={s.muted} data-favorite-out>
                    این کالا فعلاً ناموجود است.
                  </p>
                )}
                <form action={removeFavoriteAction}>
                  <input type="hidden" name="product" value={p.id} />
                  <Button type="submit" variant="ghost" size="sm" icon="close" data-favorite-remove>
                    حذف از لیست
                  </Button>
                </form>
              </div>
            ))}
          </ProductGrid>
        </>
      )}
    </>
  );
}
