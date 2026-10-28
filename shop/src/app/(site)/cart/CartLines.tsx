'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatToman } from '@/lib/format/money';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { Alert, Icon } from '@/ui';
import { removeFromCartAction, setCartQuantityAction } from '../_cart/actions';
import s from './cart.module.css';

export type CartLineData = {
  productId: number;
  name: string;
  href: string;
  imageUrl: string | null;
  quantity: number;
  maxQuantity: number;
  unitPrice: number;
  unitListPrice: number;
  discountPercent: number;
  lineTotal: number;
};

/** The cart's lines: quantity − / + (held at the stock) and «حذف». Each change is saved on the server, then the page reloads its numbers. */
export function CartLines({ items }: { items: CartLineData[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (run: () => ReturnType<typeof setCartQuantityAction>) =>
    start(async () => {
      setError(null);
      const r = await run();
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <div className={s.lines} aria-busy={pending}>
      {error && (
        <Alert tone="danger">{error}</Alert>
      )}
      <ul className={s.list} aria-label="کالاهای سبد">
        {items.map((i) => (
          <li key={i.productId} className={s.line} data-cart-line={i.productId}>
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
                  disabled={pending || i.quantity <= 1}
                  onClick={() => change(() => setCartQuantityAction(i.productId, i.quantity - 1))}
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
                  disabled={pending || i.quantity >= i.maxQuantity}
                  onClick={() => change(() => setCartQuantityAction(i.productId, i.quantity + 1))}
                >
                  <Icon name="add" size={20} />
                </button>
              </div>
              <b className={`${s.lineTotal} tnum`} data-line-total>{formatToman(i.lineTotal)} تومان</b>
              <button
                type="button"
                className={s.remove}
                disabled={pending}
                aria-label={`حذف ${i.name} از سبد`}
                onClick={() => change(() => removeFromCartAction(i.productId))}
              >
                <Icon name="close" size={18} />
                حذف
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
