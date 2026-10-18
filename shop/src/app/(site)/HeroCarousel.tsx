'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '@/ui/icon/Icon';
import s from './hero.module.css';

const INTERVAL_MS = 6000;

const reducedQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeReduced = (cb: () => void) => {
  const mq = reducedQuery();
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const subscribeVisibility = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};

/**
 * Carousel behaviour around server-rendered slides (HeroSlider): a scroll-snap track (swipe works natively and
 * without JS), previous/next buttons, one dot per slide, arrow keys (RTL: ← next, → previous, Home/End) and
 * autoplay that stops while the pointer is over it, while anything inside has focus, when the tab is hidden,
 * after the pause button, and never starts for people who prefer reduced motion.
 * Slides out of view are inert, so Tab only reaches the visible link.
 */
export function HeroCarousel({ count, children }: { count: number; children: ReactNode }) {
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  // server snapshot = no autoplay; the client takes over after hydration
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => reducedQuery().matches,
    () => true,
  );
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => false,
  );
  const ready = !reduced && visible;

  const go = useCallback(
    (i: number) => {
      const t = track.current;
      const el = t?.children[((i % count) + count) % count] as HTMLElement | undefined;
      if (!t || !el) return;
      // direction-agnostic (RTL scrollLeft is negative): move by the slide's offset from the track
      t.scrollBy({
        left: el.getBoundingClientRect().left - t.getBoundingClientRect().left,
        behavior: reduced ? 'auto' : 'smooth',
      });
    },
    [count, reduced],
  );

  // the current slide follows the scroll position (buttons, dots, keys, swipe alike)
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setIndex(Math.round(Math.abs(t.scrollLeft) / Math.max(1, t.clientWidth))),
      );
    };
    t.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      t.removeEventListener('scroll', onScroll);
    };
  }, []);

  // only the visible slide is reachable by Tab / screen readers
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    // keyboard users keep their place: focus follows to the new slide's link instead of falling to <body>
    const hadFocus = t.contains(document.activeElement);
    [...t.children].forEach((el, i) => ((el as HTMLElement).inert = i !== index));
    if (hadFocus) t.children[index]?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
  }, [index]);

  const playing = ready && count > 1 && !paused && !hovered && !focused;
  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [playing, index, go]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const to = { ArrowLeft: index + 1, ArrowRight: index - 1, Home: 0, End: count - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    go(to);
  };

  return (
    <section
      className={s.slider}
      aria-roledescription="اسلایدر"
      aria-label="پیشنهادهای ویژه"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      data-playing={playing ? 'true' : 'false'}
    >
      <ul ref={track} className={s.track} aria-live={playing ? 'off' : 'polite'}>
        {children}
      </ul>
      {count > 1 && (
        <>
          <button
            type="button"
            className={`${s.arrow} ${s.prev}`}
            onClick={() => go(index - 1)}
            aria-label="اسلاید قبلی"
          >
            <Icon name="chevron_right" size={24} />
          </button>
          <button
            type="button"
            className={`${s.arrow} ${s.next}`}
            onClick={() => go(index + 1)}
            aria-label="اسلاید بعدی"
          >
            <Icon name="chevron_left" size={24} />
          </button>
          <div className={s.controls}>
            {!reduced && (
              <button
                type="button"
                className={s.pause}
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? 'پخش خودکار اسلایدها' : 'توقف اسلایدها'}
                aria-pressed={paused}
              >
                <Icon name={paused ? 'play_arrow' : 'pause'} size={16} />
              </button>
            )}
            <ol className={s.dots}>
              {Array.from({ length: count }, (_, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={s.dot}
                    onClick={() => go(i)}
                    aria-label={`اسلاید ${(i + 1).toLocaleString('fa-IR')}`}
                    aria-current={i === index ? 'true' : undefined}
                  />
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </section>
  );
}
