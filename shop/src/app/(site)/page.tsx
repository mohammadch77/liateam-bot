import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getConfig } from '@/lib/config';
import { productPath } from '@/lib/catalog-urls';
import { toAppError } from '@/lib/errors';
import { formatToman } from '@/lib/format/money';
import { catalogService } from '@/server/services/catalog.service';
import { Container, Icon, ProductCard, ProductGrid, Section } from '@/ui';
import { CatalogUnavailable } from './_catalog/CatalogListing';
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

  return (
    <div className={s.home}>
      <Container>
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
              <Link href="/categories" className={s.ctaPrimary}>
                خرید کنید
                <Icon name="arrow_back" size={20} />
              </Link>
              <Link href="/search?sort=newest" className={s.ctaSecondary}>
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
                  {formatToman(hero.price)} <span>تومان</span>
                </b>
              </span>
            </Link>
          )}
        </section>

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

        {data.newest.length > 0 && (
          <Section
            id="newest"
            title="جدیدترین‌ها"
            action={{ href: '/search?sort=newest', label: 'مشاهده همه' }}
          >
            <ProductGrid>
              {data.newest.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 2} />
              ))}
            </ProductGrid>
          </Section>
        )}

        {data.featured.length > 0 && (
          <Section
            id="featured"
            title="منتخب‌ها"
            action={{ href: '/search?sort=price_desc', label: 'مشاهده همه' }}
          >
            <ProductGrid>
              {data.featured.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </ProductGrid>
          </Section>
        )}
      </Container>
    </div>
  );
}
