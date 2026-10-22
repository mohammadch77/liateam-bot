import { getImageProps } from 'next/image';
import Link from 'next/link';
import type { HeroSlide } from '@/server/services/catalog.service';
import { HeroCarousel } from './HeroCarousel';
import { HeroDeferredPicture } from './HeroDeferredPicture';
import s from './hero.module.css';

// Liateam's banners: 1920×800 wide (tablet and up), 750×1000 tall (phones). Text is part of the photo.
const WIDE = { width: 1920, height: 800 };
const TALL = { width: 750, height: 1000 };
const SIZES = '(min-width: 1440px) 1320px, 100vw';

/**
 * Home hero as a slider of Liateam's own home-page banners (mirrored by the sync bot). Each slide is a real link
 * to its destination on our site; photos go through our optimiser (/_next/image → WebP), the tall one on phones.
 * Rendered on the server: without JavaScript the slides still scroll/swipe (scroll-snap) and every link works.
 */
export function HeroSlider({ slides }: { slides: HeroSlide[] }) {
  const n = slides.length.toLocaleString('fa-IR');
  return (
    <HeroCarousel count={slides.length}>
      {slides.map((slide, i) => {
        const common = { alt: slide.label, sizes: SIZES, quality: 80 };
        const wide = getImageProps({ ...common, src: slide.image, ...WIDE }).props;
        const tall = getImageProps({
          ...common,
          src: slide.portrait ?? slide.image,
          ...(slide.portrait ? TALL : WIDE),
          priority: i === 0,
          loading: i === 0 ? undefined : 'lazy',
        }).props;
        return (
          <li
            key={`${i}-${slide.image}`}
            className={s.slide}
            role="group"
            aria-roledescription="اسلاید"
            aria-label={`${(i + 1).toLocaleString('fa-IR')} از ${n}`}
            style={slide.color ? { backgroundColor: slide.color } : undefined}
          >
            <Link href={slide.href} className={s.link} data-hero-link>
              {i === 0 ? (
                // the first slide is the page's largest picture (LCP): plain server HTML, requested at high priority
                <picture className={slide.portrait ? s.picture : `${s.picture} ${s.wideOnly}`}>
                  <source media="(min-width: 640px)" srcSet={wide.srcSet} sizes={SIZES} />
                  <img {...tall} alt={slide.label} className={s.image} />
                </picture>
              ) : (
                <HeroDeferredPicture
                  className={slide.portrait ? s.picture : `${s.picture} ${s.wideOnly}`}
                  wideSrcSet={wide.srcSet}
                  sizes={SIZES}
                  img={tall}
                  imgClassName={s.image}
                  alt={slide.label}
                />
              )}
            </Link>
          </li>
        );
      })}
    </HeroCarousel>
  );
}
