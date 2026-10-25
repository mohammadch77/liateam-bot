'use client';

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icon/Icon';
import { cx } from '../cx';
import s from './Carousel.module.css';

export type CarouselSize = 'card' | 'brand' | 'article' | 'compact' | 'grid4';

type CarouselProps = {
  /** accessible name of the list, e.g. «محصولات تخفیف‌دار» */
  label: string;
  /** item width preset (CSS): card ≈ 2.3 per phone screen, 4–5 on desktop; brand / article / compact for others */
  size?: CarouselSize;
  className?: string;
  /** each child is one item (give them keys) */
  children: ReactNode;
};

/** Pixels the mouse must travel before a press becomes a drag (below it, the click goes to the link). */
const DRAG_THRESHOLD = 6;

/**
 * The one horizontal scroller of the site (offers, best sellers, brands, routine, related products, magazine…).
 * Server-rendered as a native scroll-snap list, so it scrolls by touch, trackpad and keyboard without JavaScript and
 * every item's space is reserved (no layout shift). The small client part adds, on pointer devices: previous / next
 * buttons that disappear at the ends, dragging with the mouse (a drag never ends as a click on a link), and ←/→ on
 * the focused list. Touch keeps the browser's own scrolling (no jitter). The ends are found with an
 * IntersectionObserver on the first and last item, so it is the same in RTL in every browser (scrollLeft's sign is
 * not). prefers-reduced-motion: jumps instead of smooth scrolling.
 */
export function Carousel({ label, size = 'card', className, children }: CarouselProps) {
  const track = useRef<HTMLUListElement>(null);
  const [ready, setReady] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    setReady(true);
    const first = el.firstElementChild;
    const last = el.lastElementChild;
    if (!first || !last) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const fully = e.intersectionRatio > 0.95;
          if (e.target === first) setAtStart(fully);
          if (e.target === last) setAtEnd(fully);
        }
      },
      { root: el, threshold: [0, 0.95, 1] },
    );
    io.observe(first);
    if (last !== first) io.observe(last);
    return () => io.disconnect();
  }, []);

  /** step: +1 = towards the end of the list (left in RTL), -1 = towards the start */
  const scrollStep = (step: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const amount = Math.max(el.clientWidth * 0.85, 120) * step * (rtl ? -1 : 1);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: amount, behavior: reduce ? 'auto' : 'smooth' });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = e.currentTarget;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
      }
      el.scrollLeft = startScroll - dx; // content follows the pointer (scrollLeft is physical in LTR and RTL)
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) return;
      setDragging(false);
      // the click that ends a drag must not open the card under the pointer; it follows pointerup in the same turn,
      // so the guard is removed on the next tick (when released outside the list no click comes at all)
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    // ← moves towards the end in RTL, towards the start in LTR
    const towardsEnd = (e.key === 'ArrowLeft') === rtl;
    scrollStep(towardsEnd ? 1 : -1);
  };

  const items = Children.toArray(children).filter(isValidElement);
  return (
    <div className={cx(s.root, s[size], dragging && s.dragging, className)} data-carousel={size}>
      <ul
        ref={track}
        className={s.track}
        aria-label={label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDragStart={(e) => e.preventDefault()}
      >
        {items.map((child) => (
          <li key={child.key} className={s.item}>
            {child}
          </li>
        ))}
      </ul>
      {ready && (
        <>
          <button
            type="button"
            className={cx(s.arrow, s.prev)}
            aria-label="موارد قبلی"
            hidden={atStart}
            onClick={() => scrollStep(-1)}
            data-carousel-prev
          >
            <Icon name="chevron_right" size={22} />
          </button>
          <button
            type="button"
            className={cx(s.arrow, s.next)}
            aria-label="موارد بعدی"
            hidden={atEnd}
            onClick={() => scrollStep(1)}
            data-carousel-next
          >
            <Icon name="chevron_left" size={22} />
          </button>
        </>
      )}
    </div>
  );
}
