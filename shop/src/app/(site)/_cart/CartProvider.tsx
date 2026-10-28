'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatToman } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { cartPath, checkoutPath } from '@/lib/urls';
import { Button, Icon, Spinner } from '@/ui';
import { CartContext, type CartApi } from '@/ui/cart/CartContext';
import { addToCartAction, miniCartAction, type MiniCart } from './actions';
import s from './cart.module.css';

/**
 * The page's cart: the badge number, «add», the «added» confirmation and the mini-cart. The server renders the first
 * number; after that it follows what the actions return. One CartProvider wraps every storefront page (the site layout).
 */
export function CartProvider({ initialUnits, children }: { initialUnits: number; children: ReactNode }) {
  // the server's number, until an action reports a newer one; after a page refresh the server's number is the truth again
  const [local, setLocal] = useState<{ base: number; value: number } | null>(null);
  const units = local && local.base === initialUnits ? local.value : initialUnits;
  const setUnits = useCallback((value: number) => setLocal({ base: initialUnits, value }), [initialUnits]);
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [miniOpen, setMiniOpen] = useState(false);
  const [mini, setMini] = useState<MiniCart | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const add = useCallback<CartApi['add']>(
    async (productId, quantity = 1) => {
      setLoading((l) => new Set(l).add(productId));
      try {
        const r = await addToCartAction(productId, quantity);
        if (!r.ok) {
          say(r.error, false);
          return { ok: false, message: r.error };
        }
        setUnits(r.data.units);
        setDone((d) => new Set(d).add(productId));
        setTimeout(
          () =>
            setDone((d) => {
              const n = new Set(d);
              n.delete(productId);
              return n;
            }),
          1800,
        );
        say(r.data.capped ? 'به سقف موجودی رسید؛ به سبد خرید افزوده شد.' : 'به سبد خرید افزوده شد.', true);
        setMini(null); // reloaded the next time it opens
        return { ok: true };
      } catch {
        say('افزودن انجام نشد. دوباره تلاش کنید.', false);
        return { ok: false, message: 'افزودن انجام نشد.' };
      } finally {
        setLoading((l) => {
          const n = new Set(l);
          n.delete(productId);
          return n;
        });
      }
    },
    [say, setUnits],
  );

  const toggleMini = useCallback(() => setMiniOpen((o) => !o), []);

  useEffect(() => {
    if (!miniOpen || mini) return;
    let live = true;
    miniCartAction().then((r) => {
      if (live && r.ok) {
        setMini(r.data);
        setUnits(r.data.units);
      }
    });
    return () => {
      live = false;
    };
  }, [miniOpen, mini, setUnits]);

  useEffect(() => {
    if (!miniOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMiniOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-mini-cart]') && !t.closest('[data-header-action="cart"]')) setMiniOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [miniOpen]);

  const api = useMemo<CartApi>(
    () => ({
      units,
      add,
      setUnits,
      notify: say,
      state: (id) => (loading.has(id) ? 'loading' : done.has(id) ? 'done' : 'idle'),
      miniOpen,
      toggleMini,
    }),
    [units, add, setUnits, say, loading, done, miniOpen, toggleMini],
  );

  return (
    <CartContext.Provider value={api}>
      {children}
      <div className={s.toastHost} role="status" aria-live="polite">
        {toast && (
          <div
            className={toast.ok ? s.toast : `${s.toast} ${s.toastError}`}
            data-cart-toast={toast.ok ? 'ok' : 'error'}
          >
            <Icon name={toast.ok ? 'check_circle' : 'error'} size={20} />
            <span>{toast.text}</span>
            {toast.ok && (
              <Link href={cartPath()} className={s.toastLink}>
                مشاهده سبد
              </Link>
            )}
          </div>
        )}
      </div>
      {miniOpen && (
        <section className={s.mini} role="dialog" aria-label="سبد خرید" data-mini-cart>
          <header className={s.miniHead}>
            <b>سبد خرید</b>
            <button type="button" className={s.close} aria-label="بستن" onClick={() => setMiniOpen(false)}>
              <Icon name="close" size={20} />
            </button>
          </header>
          {!mini ? (
            <div className={s.miniEmpty}>
              <Spinner />
            </div>
          ) : mini.items.length === 0 ? (
            <p className={s.miniEmpty}>سبد خرید خالی است.</p>
          ) : (
            <>
              <ul className={s.miniList}>
                {mini.items.map((i) => (
                  <li key={i.productId} className={s.miniItem}>
                    <span className={s.miniThumb} aria-hidden="true">
                      {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="56px" draggable={false} />}
                    </span>
                    <Link href={i.href} className={s.miniName}>
                      {i.name}
                    </Link>
                    <span className={s.miniQty}>
                      {formatNumber(i.quantity)} × <span className="tnum">{formatToman(i.unitPrice)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {mini.more > 0 && <p className={s.miniMore}>و {formatNumber(mini.more)} کالای دیگر</p>}
              <div className={s.miniTotal}>
                <span>جمع کالاها</span>
                <b className="tnum">{formatToman(mini.itemsTotal)} تومان</b>
              </div>
              <div className={s.miniActions}>
                <Button href={cartPath()} variant="outline" block>
                  مشاهده سبد
                </Button>
                <Button href={checkoutPath()} block>
                  ثبت سفارش
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </CartContext.Provider>
  );
}
