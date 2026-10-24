'use client';

import { useEffect, useState, type ImgHTMLAttributes } from 'react';

type Props = {
  className: string | undefined;
  /** the wide banner (tablet and up) */
  wideSrcSet: string | undefined;
  sizes: string;
  /** the phone (tall) picture, as next/image's getImageProps gives it */
  img: ImgHTMLAttributes<HTMLImageElement>;
  imgClassName: string | undefined;
  alt: string;
};

/**
 * A later hero slide's picture: its box (fixed aspect ratio, so nothing moves) is in the page at once, the picture is
 * requested only once the browser is idle after the first paint. Without this, all the slides' pictures loaded together
 * with the first one and slowed it down on slow mobile networks (they were «lazy», but a horizontal slider is close
 * enough to the screen for the browser to load them anyway). Without JavaScript the <noscript> picture is used.
 */
export function HeroDeferredPicture({ className, wideSrcSet, sizes, img, imgClassName, alt }: Props) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const go = () => setShow(true);
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    };
    const start = () =>
      w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 1500);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => window.removeEventListener('load', start);
  }, []);
  const picture = (
    <>
      <source media="(min-width: 640px)" srcSet={wideSrcSet} sizes={sizes} />
      {/* eslint-disable-next-line @next/next/no-img-element -- props from next/image's getImageProps */}
      <img {...img} alt={alt} className={imgClassName} loading="lazy" />
    </>
  );
  return <picture className={className}>{show ? picture : <noscript>{picture}</noscript>}</picture>;
}
