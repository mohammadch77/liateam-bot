'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newer, withQuantity, type CartSnapshot } from '@/lib/cart/snapshot';
import { cartPath } from '@/lib/urls';
import { Icon } from '@/ui';
import { CartContext, type CartApi, type CartResult } from '@/ui/cart/CartContext';
import { addToCartAction, cartSnapshotAction, setCartQuantityAction } from './actions';
import s from './cart.module.css';
import { MiniCart, type Anchor } from './MiniCart';

/**
 * THE cart of the page: one store behind the header badge, the bottom-bar badge, the mini-cart and the cart page.
 *
 * Why one store: before, the mini-cart kept its own copy of the cart, loaded once and only dropped when a card added
 * something, while the cart page changed the cart through its own actions — so after changes on /cart the mini-cart still
 * showed the old lines and total. Now every change goes through `add` / `setQuantity` here; the server answers each with
 * the whole cart (a snapshot with a `rev` = its last-change time), the views take the newer of what they have and what
 * the server renders, and the mini-cart reads the cart again whenever it opens. A change shows at once (optimistic) and is
 * taken back, with a message, when the server refuses.
 */
export function CartProvider({
  initial,
  children,
}: {
  /** the server's units and the cart's change time at render */
  initial: { units: number; rev: number };
  children: ReactNode;
}) {
  const [server, setServer] = useState<CartSnapshot | null>(null);
  const [optimistic, setOptimistic] = useState<CartSnapshot | null>(null);
  const serverRef = useRef<CartSnapshot | null>(null);
  const optimisticRef = useRef<CartSnapshot | null>(null);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState<ReadonlySet<number>>(new Set());
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const [mini, setMini] = useState<{ path: string; anchor: Anchor | null } | null>(null);
  const miniOpen = mini !== null && mini.path === pathname; // a new page closes it

  const shown = optimistic ?? server;
  // the badge: what the store knows, unless the server's own render is newer (after a refresh, or a change from elsewhere)
  const units = shown && shown.rev >= initial.rev ? shown.units : initial.units;

  const say = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const adopt = useCallback((snap: CartSnapshot) => {
    const next = newer(snap, serverRef.current);
    if (next === snap) {
      serverRef.current = snap;
      setServer(snap);
    }
  }, []);

  const mark = useCallback(
    (set: (f: (s: ReadonlySet<number>) => ReadonlySet<number>) => void, id: number, on: boolean) => {
      set((cur) => {
        const n = new Set(cur);
        if (on) n.add(id);
        else n.delete(id);
        return n;
      });
    },
    [],
  );

  const resync = useCallback(async () => {
    const r = await cartSnapshotAction().catch(() => null);
    if (r?.ok) adopt(r.data);
  }, [adopt]);

  const add = useCallback<CartApi['add']>(
    async (productId, quantity = 1) => {
      mark(setLoading, productId, true);
      try {
        const r = await addToCartAction(productId, quantity);
        if (!r.ok) {
          say(r.error, false);
          return { ok: false, message: r.error };
        }
        adopt(r.data.snapshot);
        mark(setDone, productId, true);
        setTimeout(() => mark(setDone, productId, false), 1800);
        say(r.data.capped ? 'به سقف موجودی رسید؛ به سبد خرید افزوده شد.' : 'به سبد خرید افزوده شد.', true);
        return { ok: true };
      } catch {
        say('افزودن انجام نشد. دوباره تلاش کنید.', false);
        return { ok: false, message: 'افزودن انجام نشد.' };
      } finally {
        mark(setLoading, productId, false);
      }
    },
    [say, adopt, mark],
  );

  const setQuantity = useCallback<CartApi['setQuantity']>(
    (productId, quantity, base) => {
      // shown at once: built on what is on screen now (an earlier change still on its way included)
      const basis = optimisticRef.current ?? newer(serverRef.current, base ?? null);
      pending.current += 1;
      mark(setBusyIds, productId, true);
      if (basis) {
        // while changes are on their way this wins over any server render (rev = the highest): no flicker back
        optimisticRef.current = { ...withQuantity(basis, productId, quantity), rev: Number.MAX_SAFE_INTEGER };
        setOptimistic(optimisticRef.current);
      }
      const job = queue.current.then(async (): Promise<CartResult> => {
        try {
          const r = await setCartQuantityAction(productId, quantity);
          if (!r.ok) throw new Error(r.error);
          adopt(r.data.snapshot);
          if (r.data.capped) say('به سقف موجودی این کالا رسیدید.', true);
          return { ok: true };
        } catch (e) {
          // taken back: the server's cart is the truth
          optimisticRef.current = null;
          setOptimistic(null);
          const message = e instanceof Error && e.message ? e.message : 'تغییر انجام نشد. دوباره تلاش کنید.';
          say(message, false);
          await resync();
          return { ok: false, message };
        } finally {
          pending.current -= 1;
          mark(setBusyIds, productId, false);
          if (pending.current === 0) {
            optimisticRef.current = null;
            setOptimistic(null);
          }
        }
      });
      queue.current = job;
      return job;
    },
    [adopt, mark, resync, say],
  );

  // ── the mini-cart: where it hangs (desktop), and how it opens / closes ──
  // under the cart icon that is on screen; under the compact bar when that is the one (its edge does not move on hover)
  const anchorNow = useCallback((): Anchor | null => {
    const icons = [...document.querySelectorAll<HTMLElement>('[data-cart-anchor]')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight);
    const pick = icons.sort((a, b) => a.r.top - b.r.top).at(-1);
    if (!pick) return null;
    const bar = pick.el.closest('[data-sticky-bar]');
    const edge = bar ? bar.getBoundingClientRect().bottom : pick.r.bottom;
    const left = Math.max(8, Math.min(pick.r.left, window.innerWidth - 400 - 8));
    return { top: Math.round(edge + 8), left: Math.round(left) };
  }, []);

  const openMini = useCallback(
    () => setMini({ path: window.location.pathname, anchor: anchorNow() }),
    [anchorNow],
  );
  const closeMini = useCallback(() => setMini(null), []);
  // `miniOpen` (not the raw state): after a page change the old state is still there but the panel is closed
  const toggleMini = useCallback(() => {
    if (miniOpen) setMini(null);
    else setMini({ path: window.location.pathname, anchor: anchorNow() });
  }, [miniOpen, anchorNow]);

  // opening reads the cart again (another tab or device may have changed it)
  useEffect(() => {
    if (miniOpen) void resync();
  }, [miniOpen, resync]);

  // outside click and Escape close it; the panel follows its icon while the page scrolls
  useEffect(() => {
    if (!miniOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-mini-cart]') && !t.closest('[data-cart-anchor]') && !t.closest('[data-cart-tab]'))
        setMini(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMini(null);
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMini((cur) => (cur ? { ...cur, anchor: anchorNow() } : cur)));
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
    };
  }, [miniOpen, anchorNow]);

  // phones: the page behind the bottom sheet does not scroll (position:fixed keeps its place, so nothing jumps)
  useEffect(() => {
    if (!miniOpen || !window.matchMedia('(max-width: 1023px)').matches) return;
    const y = window.scrollY;
    const b = document.body.style;
    const before = { position: b.position, top: b.top, insetInline: b.insetInline, width: b.width };
    b.position = 'fixed';
    b.top = `-${y}px`;
    b.insetInline = '0';
    b.width = '100%';
    return () => {
      b.position = before.position;
      b.top = before.top;
      b.insetInline = before.insetInline;
      b.width = before.width;
      window.scrollTo(0, y);
    };
  }, [miniOpen]);

  const api = useMemo<CartApi>(
    () => ({
      units,
      snapshot: shown,
      add,
      setQuantity,
      adopt,
      notify: say,
      state: (id) => (loading.has(id) ? 'loading' : done.has(id) ? 'done' : 'idle'),
      busy: (id) => busyIds.has(id),
      miniOpen,
      openMini,
      closeMini,
      toggleMini,
    }),
    [
      units,
      shown,
      add,
      setQuantity,
      adopt,
      say,
      loading,
      done,
      busyIds,
      miniOpen,
      openMini,
      closeMini,
      toggleMini,
    ],
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
      {miniOpen && <MiniCart anchor={mini?.anchor ?? null} onClose={closeMini} />}
    </CartContext.Provider>
  );
}
