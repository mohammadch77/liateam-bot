'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { newer, type CartSnapshot } from '@/lib/cart/snapshot';
import { formatToman } from '@/lib/format/money';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { checkoutPath } from '@/lib/urls';
import { Alert, Button, Icon } from '@/ui';
import { useCart } from '@/ui/cart/CartContext';
import s from './cart.module.css';

/**
 * The cart page: the lines, quantity − / + (held at the stock), «حذف» and the summary. It reads the cart from the page's
 * one store (the same one the header badge and the mini-cart read): `initial` is what the server rendered, and whichever
 * of that and the store's snapshot is newer is shown, so a change made in the mini-cart is here at once and the other way
 * round. Changes show at once and go back with a message when the server refuses; the page then reloads its server parts.
 */
export function CartView({
  initial,
  freeFromToman,
}: {
  initial: CartSnapshot;
  /** «ارسال رایگان از مبلغ X» when the shop promises it, else null */
  freeFromToman: number | null;
}) {
  const router = useRouter();
  const cart = useCart();
  const snap = newer(cart?.snapshot, initial) ?? initial;
  const [error, setError] = useState<string | null>(null);

  const change = async (productId: number, quantity: number) => {
    if (!cart) return;
    setError(null);
    const r = await cart.setQuantity(productId, quantity, snap);
    if (!r.ok) setError(r.message ?? 'تغییر انجام نشد.');
    router.refresh();
  };

  const remaining = freeFromToman === null ? null : Math.max(0, freeFromToman - snap.itemsTotal);
  return (
    <>
      <h1 className={s.title}>
        سبد خرید <span className={s.count}>({toFaDigits(snap.units)} کالا)</span>
      </h1>
      <div className={s.layout}>
        <div className={s.lines}>
          {error && <Alert tone="danger">{error}</Alert>}
          <ul className={s.list} aria-label="کالاهای سبد">
            {snap.items.map((i) => {
              const busy = cart?.busy(i.productId) ?? false;
              return (
                <li key={i.productId} className={s.line} data-cart-line={i.productId} aria-busy={busy}>
                  <Link href={i.href} className={s.thumb} aria-hidden="true" tabIndex={-1}>
                    {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="96px" draggable={false} />}
                  </Link>
                  <div className={s.info}>
                    <Link href={i.href} className={s.name}>
                      {i.name}
                    </Link>
                    <span className={s.unit}>
                      {i.unitListPrice > i.unitPrice && <del className="tnum">{formatToman(i.unitListPrice)}</del>}
                      <b className="tnum">{formatToman(i.unitPrice)}</b> تومان
                      {i.discountPercent > 0 && <span className={s.badge}>{toFaDigits(i.discountPercent)}٪ تخفیف</span>}
                    </span>
                    {i.quantity >= i.maxQuantity && <span className={s.limit}>حداکثر موجودی انبار</span>}
                  </div>
                  <div className={s.controls}>
                    <div className={s.stepper} role="group" aria-label={`تعداد ${i.name}`}>
                      <button
                        type="button"
                        className={s.stepBtn}
                        aria-label="کم کردن"
                        disabled={i.quantity <= 1}
                        onClick={() => void change(i.productId, i.quantity - 1)}
                      >
                        <Icon name="remove" size={20} />
                      </button>
                      <span className={`${s.qty} tnum`} aria-live="polite" data-line-qty>
                        {formatNumber(i.quantity)}
                      </span>
                      <button
                        type="button"
                        className={s.stepBtn}
                        aria-label="زیاد کردن"
                        disabled={i.quantity >= i.maxQuantity}
                        onClick={() => void change(i.productId, i.quantity + 1)}
                      >
                        <Icon name="add" size={20} />
                      </button>
                    </div>
                    <b className={`${s.lineTotal} tnum`} data-line-total>
                      {formatToman(i.lineTotal)} تومان
                    </b>
                    <button
                      type="button"
                      className={s.remove}
                      aria-label={`حذف ${i.name} از سبد`}
                      onClick={() => void change(i.productId, 0)}
                    >
                      <Icon name="close" size={18} />
                      حذف
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <aside className={s.summary} aria-label="خلاصه‌ی سبد" data-cart-summary>
          <dl className={s.rows}>
            <div>
              <dt>جمع کالاها (قیمت لیاتیم)</dt>
              <dd className="tnum">{formatToman(snap.listTotal)} تومان</dd>
            </div>
            {snap.discountTotal > 0 && (
              <div className={s.off}>
                <dt>تخفیف</dt>
                <dd className="tnum" data-cart-discount>
                  − {formatToman(snap.discountTotal)} تومان
                </dd>
              </div>
            )}
            <div className={s.total} aria-live="polite" aria-atomic="true">
              <dt>جمع کل</dt>
              <dd className="tnum" data-cart-total>
                {formatToman(snap.itemsTotal)} تومان
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
    </>
  );
}
