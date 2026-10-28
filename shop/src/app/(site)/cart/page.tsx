import type { Metadata } from 'next';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { checkoutPath, shopPath } from '@/lib/urls';
import { logger } from '@/lib/logger';
import { bestsellerService } from '@/server/services/bestseller.service';
import { cartService } from '@/server/services/cart.service';
import { orderSettingsService } from '@/server/services/order-settings.service';
import { Breadcrumb, Button, Carousel, Container, EmptyState, ProductCard } from '@/ui';
import { CartLines } from './CartLines';
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

  const free = settings.freeShipping;
  const remaining = free.enabled ? Math.max(0, free.fromToman - cart.itemsTotal) : null;

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'سبد خرید' }]} />
      <h1 className={s.title}>
        سبد خرید <span className={s.count}>({toFaDigits(cart.units)} کالا)</span>
      </h1>
      <div className={s.layout}>
        <CartLines
          items={cart.items.map((i) => ({
            productId: i.productId,
            name: i.name,
            href: i.href,
            imageUrl: i.imageUrl,
            quantity: i.quantity,
            maxQuantity: i.maxQuantity,
            unitPrice: i.unitPrice,
            unitListPrice: i.unitListPrice,
            discountPercent: i.discountPercent,
            lineTotal: i.lineTotal,
          }))}
        />
        <aside className={s.summary} aria-label="خلاصه‌ی سبد" data-cart-summary>
          <dl className={s.rows}>
            <div>
              <dt>جمع کالاها (قیمت لیاتیم)</dt>
              <dd className="tnum">{formatToman(cart.listTotal)} تومان</dd>
            </div>
            {cart.discountTotal > 0 && (
              <div className={s.off}>
                <dt>تخفیف</dt>
                <dd className="tnum" data-cart-discount>
                  − {formatToman(cart.discountTotal)} تومان
                </dd>
              </div>
            )}
            <div className={s.total}>
              <dt>جمع کل</dt>
              <dd className="tnum" data-cart-total>
                {formatToman(cart.itemsTotal)} تومان
              </dd>
            </div>
          </dl>
          <p className={s.note}>هزینه‌ی ارسال در مرحله‌ی بعد، بر اساس آدرس شما محاسبه می‌شود.</p>
          {remaining !== null && (
            <p className={s.free} data-free-shipping>
              {remaining > 0
                ? `با ${formatToman(remaining)} تومان خرید بیشتر، ارسال رایگان می‌شود.`
                : 'ارسال این سفارش رایگان است.'}
            </p>
          )}
          <Button href={checkoutPath()} size="lg" block iconEnd="arrow_back">
            ادامه و ثبت سفارش
          </Button>
        </aside>
      </div>
    </Container>
  );
}
