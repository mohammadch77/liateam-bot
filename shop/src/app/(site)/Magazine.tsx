import { getConfig } from '@/lib/config';
import { Carousel, Icon } from '@/ui';
import s from './home-sections.module.css';

/**
 * Home «مجله <brand>» (Homepage.dc.html; the name from BRAND_NAME): the design's frame of three article cards. There are no articles yet (no
 * content system): the section says «به‌زودی» instead of made-up cards; the slots sit in the shared Carousel (swipe,
 * drag, arrows) so real articles drop in without a layout change. The switch `magazine.enabled` in
 * site_settings is where the real articles will plug in later.
 */
export function Magazine() {
  return (
    <section
      className={s.section}
      aria-labelledby="magazine-title"
      data-home-section="magazine"
      data-magazine="soon"
    >
      <div className={s.head}>
        <h2 id="magazine-title" className={s.title}>
          {`مجله ${getConfig().BRAND_NAME}`}
        </h2>
      </div>
      <Carousel label={`مقاله‌های مجله ${getConfig().BRAND_NAME}`} size="article">
        {['راهنمای خرید', 'روتین پوستی', 'عطر'].map((tag, i) => (
          <div key={tag} className={s.magazineSlot} aria-hidden={i > 0 ? 'true' : undefined}>
            <span className={s.magazineImage}>
              <Icon name="spa" size={34} />
            </span>
            {i === 0 ? (
              <>
                <b>به‌زودی</b>
                <span>
                  مقاله‌های راهنمای خرید، روتین مراقبت پوست و مو و معرفی عطرها به‌زودی همین‌جا منتشر می‌شوند.
                </span>
              </>
            ) : (
              <span>{tag} · به‌زودی</span>
            )}
          </div>
        ))}
      </Carousel>
    </section>
  );
}
