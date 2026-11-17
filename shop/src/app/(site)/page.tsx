import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { categoriesPath, productPath, searchPath, shopPath, withQuery } from '@/lib/urls';
import { toAppError } from '@/lib/errors';
import { formatToman } from '@/lib/format/money';
import { logger } from '@/lib/logger';
import { catalogService } from '@/server/services/catalog.service';
import { bestsellerService } from '@/server/services/bestseller.service';
import { Container, Icon } from '@/ui';
import { CatalogUnavailable } from './_catalog/CatalogListing';
import { HeroSlider } from './HeroSlider';
import { Bestsellers, type BestsellerCard } from './Bestsellers';
import { BrandsRow, type BrandTile } from './BrandsRow';
import { Magazine } from './Magazine';
import { OffersRail } from './OffersRail';
import s from './home.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `${brand} | فروشگاه محصولات آرایشی و بهداشتی اصل`,
    description: `خرید محصولات آرایشی، بهداشتی و مراقبت پوست و مو با ضمانت اصالت و ارسال به سراسر ایران از ${brand}.`,
  };
}

export default async function HomePage() {
  let data: Awaited<ReturnType<typeof catalogService.home>>;
  try {
    data = await catalogService.home();
  } catch (e) {
    return (
      <Container>
        <CatalogUnavailable message={toAppError(e).message} />
      </Container>
    );
  }
  const hero = data.featuredHero;
  // «برندها» and the first «پرفروش‌ترین‌ها» tab; neither fails the home page
  const brands: BrandTile[] = (await catalogService.brands().catch(() => [])).map((b) => ({
    code: b.code,
    name: b.name,
    href: b.href,
    logoUrl: b.logoUrl,
    thumbs: b.thumbs,
  }));
  const bestsellerTabs = bestsellerService.tabs.map((t) => ({
    key: t.key,
    label: t.label,
    href: t.key === 'all' ? shopPath() : withQuery(shopPath(), { group: t.key }),
  }));
  const bestsellersFirst: BestsellerCard[] = (
    await bestsellerService.tab('all').catch((e) => {
      logger.warn('home.bestsellers_unavailable', { err: e });
      return [];
    })
  ).map((p) => ({
    id: p.id,
    href: p.href,
    name: p.name,
    brand: p.brand ?? null,
    imageUrl: p.imageUrl ?? null,
    priceToman: p.priceToman,
    oldPriceToman: p.oldPriceToman ?? null,
    stock: p.stock,
  }));

  return (
    <div className={s.home} data-home-page>
      <Container>
        {data.heroSlides.length > 0 ? (
          <>
            <h1 className="sr-only">{`${getConfig().BRAND_NAME} | فروشگاه محصولات آرایشی و بهداشتی اصل`}</h1>
            <HeroSlider slides={data.heroSlides} />
          </>
        ) : (
          <section className={s.hero} aria-labelledby="hero-title">
            <div className={s.heroText}>
              <span className={s.kicker}>
                <span className={s.kickerDot} aria-hidden="true" />
                مستقیم از تأمین‌کننده رسمی
              </span>
              <h1 id="hero-title" className={s.heroTitle}>
                درخشش اصیل،
                <br />
                با <span className={s.heroAccent}>ضمانت اصالت</span>
              </h1>
              <p className={s.heroLead}>
                سرم‌ها، ضدآفتاب‌ها، عطرها و محصولات مراقبت مو و پوست؛ همه اصل، با قیمت به‌روز و ارسال به سراسر
                ایران.
              </p>
              <div className={s.heroCtas}>
                <Link href={categoriesPath()} className={s.ctaPrimary}>
                  خرید کنید
                  <Icon name="arrow_back" size={20} />
                </Link>
                <Link href={withQuery(searchPath(), { sort: 'newest' })} className={s.ctaSecondary}>
                  جدیدترین‌ها
                </Link>
              </div>
              <ul className={s.heroTrust}>
                <li>
                  <Icon name="verified" size={19} className={s.trustIcon} />
                  ضمانت اصالت
                </li>
                <li>
                  <Icon name="local_shipping" size={19} className={s.trustIcon} />
                  ارسال سریع
                </li>
                <li>
                  <Icon name="assignment_return" size={19} className={s.trustIcon} />۷ روز بازگشت
                </li>
              </ul>
            </div>

            {hero?.image_url && (
              <Link
                href={productPath(hero.id, hero.name, hero.slug_en)}
                className={s.heroVisual}
                aria-label={hero.name}
              >
                <span className={s.heroPedestal} aria-hidden="true" />
                <span className={s.heroImage}>
                  <Image src={hero.image_url} alt="" fill priority sizes="(min-width: 1024px) 520px, 80vw" />
                </span>
                <span className={s.heroChip}>
                  <span className={s.heroChipName}>{hero.name.replace(/\s+/g, ' ')}</span>
                  <b className={s.heroChipPrice}>
                    {formatToman(data.featuredHeroPrice)} <span>تومان</span>
                  </b>
                </span>
              </Link>
            )}
          </section>
        )}

        {data.categories.length > 0 && (
          <nav aria-label="دسته‌بندی‌های اصلی" className={s.bubbles}>
            {data.categories.map((c, i) => (
              <Link key={c.code} href={c.href} className={s.bubble}>
                <span className={i < 3 ? `${s.ring} ${s.ringAccent}` : s.ring}>
                  <span className={s.bubbleInner}>
                    {c.imageUrl ? (
                      <Image src={c.imageUrl} alt="" width={96} height={96} className={s.bubbleImage} />
                    ) : (
                      <Icon name="spa" size={40} />
                    )}
                  </span>
                </span>
                <span className={s.bubbleLabel}>{c.name}</span>
              </Link>
            ))}
          </nav>
        )}

        <OffersRail items={data.offers} campaign={data.offersCampaign} />

        <BrandsRow brands={brands} />

        <Bestsellers tabs={bestsellerTabs} initial={bestsellersFirst} />

        <section className={s.packsBanner} aria-labelledby="packs-band-title" data-home-section="packs">
          <div className={s.bannerGrid}>
            <div className={s.bannerText}>
              <span className={s.kicker}>
                <span className={s.kickerDot} aria-hidden="true" />
                پک‌های کاربردی و روتین‌ها
              </span>
              <h2 id="packs-band-title" className={s.bannerTitle}>
                مراقبت حرفه‌ای، <span className={s.heroAccent}>خرید اقتصادی</span> با پک‌های کاربردی
              </h2>
              <p className={s.bannerLead}>
                محصولات مکمل پوست و مو را در قالب پک‌های هماهنگ با تخفیف ویژه پکیج تهیه کنید؛ روتین‌های روزانه، ضدجوش، ضدلک و تقویت مو با ضمانت اصالت.
              </p>
              <div className={s.bannerPills}>
                <span>
                  <Icon name="bolt" size={16} /> تخفیف ویژه پکیج
                </span>
                <span>
                  <Icon name="verified" size={16} /> ترکیبات هماهنگ و موثر
                </span>
                <span>
                  <Icon name="local_shipping" size={16} /> ارسال سریع سراسر ایران
                </span>
              </div>
              <Link href="/shop/packs" className={s.ctaPrimary}>
                مشاهده همه پک‌های کاربردی
                <Icon name="arrow_back" size={20} />
              </Link>
            </div>
            <div className={s.bannerVisual}>
              <Image
                src="/images/packs-banner.png"
                alt="پک‌های کاربردی و روتین‌های پوستی"
                width={480}
                height={360}
                sizes="(min-width: 1024px) 440px, (min-width: 768px) 340px, 90vw"
                className={s.bannerImg}
              />
            </div>
          </div>
        </section>

        <Magazine />

        <section className={s.affiliate} aria-labelledby="affiliate-band-title" data-home-section="affiliate">
          <div className={s.bannerGrid}>
            <div className={s.bannerText}>
              <span className={s.kicker}>
                <span className={s.kickerDot} aria-hidden="true" />
                همکاری در فروش
              </span>
              <h2 id="affiliate-band-title" className={s.bannerTitle}>
                پیج یا فروشگاه داری؟ <span className={s.heroAccent}>فروشنده‌ی همکار</span> ما شو
              </h2>
              <p className={s.bannerLead}>
                محصولات اصل را به مخاطبانت معرفی کن؛ موجودی، بسته‌بندی و ارسال با ما.
              </p>
              <div className={s.bannerPills}>
                <span>
                  <Icon name="trending_up" size={16} /> پورسانت آنی و شفاف
                </span>
                <span>
                  <Icon name="verified" size={16} /> بدون نیاز به سرمایه اولیه
                </span>
                <span>
                  <Icon name="support_agent" size={16} /> پشتیبانی اختصاصی همکاران
                </span>
              </div>
              <Link href="/affiliate?from=home" className={s.ctaPrimary}>
                ثبت درخواست همکاری
                <Icon name="arrow_back" size={20} />
              </Link>
            </div>
            <div className={s.bannerVisual}>
              <Image
                src="/images/affiliate-banner.png"
                alt="همکاری در فروش آوینا"
                width={480}
                height={360}
                sizes="(min-width: 1024px) 440px, (min-width: 768px) 340px, 90vw"
                className={s.bannerImg}
              />
            </div>
          </div>
        </section>
      </Container>
    </div>
  );
}
