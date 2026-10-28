import type { Metadata } from 'next';
import { shopPath } from '@/lib/urls';
import { logger } from '@/lib/logger';
import { bestsellerService } from '@/server/services/bestseller.service';
import { cartService } from '@/server/services/cart.service';
import { orderSettingsService } from '@/server/services/order-settings.service';
import { Breadcrumb, Button, Carousel, Container, EmptyState, ProductCard } from '@/ui';
import { CartView } from './CartView';
import { freeShippingFrom } from '@/lib/shipping';
import s from './cart.module.css';

export const metadata: Metadata = { title: 'سبد خرید', robots: { index: false, follow: false } };

/**
 * «سبد خرید»: the lines (shop price in front, Liateam's struck through), quantity and remove, the totals and the way on to
 * the checkout; an empty cart suggests the best sellers. Every number is computed on the server from the database's prices.
 */
export default async function CartPage() {
  const [cart, settings] = await Promise.all([cartService.view(), orderSettingsService.get()]);

  if (cart.empty) {
    const suggestions = await bestsellerService.tab('all').catch((e) => {
      logger.warn('cart.suggestions_unavailable', { err: e });
      return [];
    });
    return (
      <Container className={s.page}>
        <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید' }]} />
        <h1 className={s.title}>سبد خرید</h1>
        <div data-cart-empty>
          <EmptyState
            icon="shopping_bag"
            title="سبد خرید شما خالی است"
            action={
              <Button href={shopPath()} icon="arrow_back">
                رفتن به فروشگاه
              </Button>
            }
          >
            محصولات مورد علاقه‌تان را به سبد اضافه کنید.
          </EmptyState>
        </div>
        {suggestions.length > 0 && (
          <section aria-labelledby="cart-suggest" className={s.suggest}>
            <h2 id="cart-suggest" className={s.suggestTitle}>
              پیشنهاد ما
            </h2>
            <Carousel label="پیشنهاد ما">
              {suggestions.slice(0, 8).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </Carousel>
          </section>
        )}
      </Container>
    );
  }

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید' }]} />
      <CartView initial={await cartService.snapshot()} freeFromToman={freeShippingFrom(settings.freeShipping)} />
    </Container>
  );
}
