'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCart } from '@/ui/cart/CartContext';
import { FavoritesContext, type FavoritesApi } from '@/ui/favorites/FavoritesContext';
import { favoritesStateAction, setFavoriteAction } from './actions';

/** the list with one product put in or taken out (a new set: the old one is never changed) */
const flip = (list: ReadonlySet<number>, id: number, on: boolean): ReadonlySet<number> => {
  const n = new Set(list);
  if (on) n.add(id);
  else n.delete(id);
  return n;
};

/**
 * THE favourites of the page: one store behind every heart. The public pages stay cacheable and carry no per-person data: after the
 * page has loaded, the first heart on it asks the server once which products the customer has (and whether anyone is signed in).
 * A click flips the heart at once and is taken back, with a message, when the server refuses; a guest is sent to the sign-in and
 * returns to the page they were on.
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const cart = useCart();
  const router = useRouter();
  const path = usePathname();
  const [ids, setIdsState] = useState<ReadonlySet<number>>(new Set());
  const idsRef = useRef<ReadonlySet<number>>(new Set()); // the latest list, readable inside a click (a state updater runs later)
  const setIds = useCallback((next: ReadonlySet<number>) => {
    idsRef.current = next;
    setIdsState(next);
  }, []);
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const signedIn = useRef<boolean | null>(null);
  const loading = useRef<Promise<void> | null>(null);

  const load = useCallback(() => {
    if (loading.current) return;
    loading.current = favoritesStateAction()
      .then((r) => {
        if (r.ok) {
          signedIn.current = r.data.signedIn;
          setIds(new Set(r.data.ids));
        }
      })
      .catch(() => {
        loading.current = null; // a failed read may be tried again by the next heart
      });
  }, [setIds]);

  const toggle = useCallback(
    (productId: number) => {
      const go = async () => {
        if (signedIn.current === null) {
          loading.current = null;
          load();
          await loading.current;
        }
        if (signedIn.current === false) {
          router.push(`/login?next=${encodeURIComponent(`${path}${window.location.search}`)}`);
          return;
        }
        const next = !idsRef.current.has(productId);
        setIds(flip(idsRef.current, productId, next));
        setBusy((b) => new Set(b).add(productId));
        try {
          const r = await setFavoriteAction(productId, next);
          if (!r.ok) throw new Error(r.error);
          cart?.notify(next ? 'به علاقه‌مندی‌ها افزوده شد.' : 'از علاقه‌مندی‌ها حذف شد.', true);
        } catch (e) {
          setIds(flip(idsRef.current, productId, !next));
          cart?.notify(e instanceof Error && e.message ? e.message : 'تغییر انجام نشد. دوباره تلاش کنید.', false);
        } finally {
          setBusy((b) => {
            const n = new Set(b);
            n.delete(productId);
            return n;
          });
        }
      };
      void go();
    },
    [cart, load, path, router, setIds],
  );

  const api = useMemo<FavoritesApi>(
    () => ({ has: (id) => ids.has(id), busy: (id) => busy.has(id), load, toggle }),
    [ids, busy, load, toggle],
  );
  return <FavoritesContext.Provider value={api}>{children}</FavoritesContext.Provider>;
}
