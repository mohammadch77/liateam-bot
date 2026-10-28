'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { formatToman } from '@/lib/format/money';
import { formatNumber, toFaDigits } from '@/lib/format/number';
import { cartPath, checkoutPath } from '@/lib/urls';
import { Button, Icon, Spinner } from '@/ui';
import { useCart } from '@/ui/cart/CartContext';
import s from './mini-cart.module.css';

export type Anchor = { top: number; left: number };

/**
 * The mini-cart. From 1024px a panel that hangs under the cart icon (it follows the icon while the page scrolls and
 * stays put under the sticky bar); on phones a bottom sheet with a dark backdrop, a handle and its own scrolling (the
 * page behind is locked by the provider). All the lines scroll inside; the total and the two buttons stay at the
 * bottom. It only reads and changes the cart through the page's one store (useCart): what it shows is what the cart
 * page and the header badge show.
 */
export function MiniCart({ anchor, onClose }: { anchor: Anchor | null; onClose: () => void }) {
  const cart = useCart();
  const panel = useRef<HTMLElement>(null);
  const snap = cart?.snapshot ?? null;

  // focus goes into the panel when it opens and back to what opened it when it closes
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Tab stays inside the panel (it is a dialog); Escape closes
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')].filter((x) => x.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!cart) return null;
  const style = anchor ? ({ '--mini-top': `${anchor.top}px`, '--mini-left': `${anchor.left}px` } as React.CSSProperties) : undefined;

  return (
    <>
      <div className={s.backdrop} onClick={onClose} data-mini-backdrop aria-hidden="true" />
      <section
        ref={panel}
        tabIndex={-1}
        className={s.panel}
        style={style}
        role="dialog"
        aria-label="سبد خرید"
        data-mini-cart
        onKeyDown={onKey}
      >
        <span className={s.handle} aria-hidden="true" />
        <header className={s.head}>
          <b>
            سبد خرید{snap && snap.units > 0 ? <span className={s.count}> ({formatNumber(snap.units)} کالا)</span> : null}
          </b>
          <button type="button" className={s.close} aria-label="بستن" onClick={onClose} data-mini-close>
            <Icon name="close" size={20} />
          </button>
        </header>

        {!snap ? (
          <div className={s.empty}>
            <Spinner />
          </div>
        ) : snap.items.length === 0 ? (
          <p className={s.empty} data-mini-empty>
            سبد خرید خالی است.
          </p>
        ) : (
          <>
            <div className={s.scroll} data-mini-scroll>
              <ul className={s.list}>
                {snap.items.map((i) => {
                  const busy = cart.busy(i.productId);
                  return (
                    <li key={i.productId} className={s.item} aria-busy={busy} data-mini-line={i.productId} data-busy={busy}>
                      <Link href={i.href} className={s.thumb} aria-hidden="true" tabIndex={-1}>
                        {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" draggable={false} />}
                      </Link>
                      <div className={s.info}>
                        <Link href={i.href} className={s.name}>
                          {i.name}
                        </Link>
                        <span className={s.unit}>
                          {i.unitListPrice > i.unitPrice && <del className="tnum">{formatToman(i.unitListPrice)}</del>}
                          <b className="tnum">{formatToman(i.unitPrice)}</b> تومان
                        </span>
                        {i.quantity >= i.maxQuantity && <span className={s.limit}>حداکثر موجودی</span>}
                      </div>
                      <div className={s.controls}>
                        <div className={s.stepper} role="group" aria-label={`تعداد ${i.name}`}>
                          <button
                            type="button"
                            className={s.stepBtn}
                            aria-label="کم کردن"
                            disabled={i.quantity <= 1}
                            onClick={() => void cart.setQuantity(i.productId, i.quantity - 1)}
                          >
                            <Icon name="remove" size={18} />
                          </button>
                          <span className={`${s.qty} tnum`} data-mini-qty>
                            {formatNumber(i.quantity)}
                          </span>
                          <button
                            type="button"
                            className={s.stepBtn}
                            aria-label="زیاد کردن"
                            disabled={i.quantity >= i.maxQuantity}
                            onClick={() => void cart.setQuantity(i.productId, i.quantity + 1)}
                          >
                            <Icon name="add" size={18} />
                          </button>
                        </div>
                        <button
                          type="button"
                          className={s.remove}
                          aria-label={`حذف ${i.name} از سبد`}
                          onClick={() => void cart.setQuantity(i.productId, 0)}
                          data-mini-remove
                        >
                          <Icon name="close" size={18} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <footer className={s.foot}>
              <div className={s.total} aria-live="polite" aria-atomic="true">
                <span>جمع کالاها ({toFaDigits(snap.units)})</span>
                <b className="tnum" data-mini-total>
                  {formatToman(snap.itemsTotal)} تومان
                </b>
              </div>
              <div className={s.actions}>
                <Button href={cartPath()} variant="outline" block>
                  مشاهده سبد
                </Button>
                <Button href={checkoutPath()} block>
                  ثبت سفارش
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>
    </>
  );
}
