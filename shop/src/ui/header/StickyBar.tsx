'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CartLink } from './CartLink';
import s from './Header.module.css';

/**
 * The compact bar that appears at the top (from 1024px) once the real header has scrolled out of view, so the cart icon
 * and its number are always on screen. It is fixed (it never moves the page: no layout shift) and slides in only after
 * the header's end passes the top edge of the window. The tab bar does the same job on phones.
 */
export function StickyBar({
  brandName,
  homeHref,
  cartHref,
  cartCount,
}: {
  brandName: string;
  homeHref: string;
  cartHref: string;
  cartCount: number;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setShown(!!e && !e.isIntersecting && e.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className={s.stickySentinel} aria-hidden="true" />
      <div
        className={s.sticky}
        data-sticky-bar
        data-shown={shown}
        aria-hidden={shown ? undefined : true}
        inert={!shown}
      >
        <div className={s.stickyInner}>
          <Link href={homeHref} className={s.stickyBrand} tabIndex={shown ? 0 : -1}>
            {brandName}
            <span className={s.logoDot}>.</span>
          </Link>
          <CartLink href={cartHref} count={cartCount} variant="sticky" />
        </div>
      </div>
    </>
  );
}
