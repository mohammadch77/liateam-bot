import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import React from 'react';
import { getConfig } from '@/lib/config';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { packService, type CollectionView } from '@/server/services/pack.service';
import { Breadcrumb, Container, EmptyState, Icon } from '@/ui';
import s from './packs.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `پک‌های کاربردی و روتین‌ها | ${brand}`,
    description: `مجموعه‌ها و پک‌های تخصصی مراقبت پوست و مو با تخفیف ویژه پکیج و ارسال سریع به سراسر ایران از ${brand}.`,
  };
}

export default async function PacksPage() {
  const collections: CollectionView[] = await packService.homeCollections().catch(() => []);

  return (
    <Container className={s.page}>
      <Breadcrumb
        items={[
          { label: 'خانه', href: '/' },
          { label: 'فروشگاه', href: '/shop' },
          { label: 'پک‌های کاربردی' },
        ]}
      />

      <header className={s.hero} aria-labelledby="packs-hero-title">
        <div className={s.heroGrid}>
          <div className={s.heroText}>
            <span className={s.kicker}>
              <span className={s.kickerDot} aria-hidden="true" />
              پیشنهاد ویژه آوینا
            </span>
            <h1 id="packs-hero-title" className={s.title}>
              پک‌های کاربردی و <span className={s.titleAccent}>روتین‌های مراقبتی</span>
            </h1>
            <p className={s.lead}>
              ترکیب هوشمندانه بهترین محصولات مکمل پوست و مو، چیده شده توسط کارشناسان زیبایی. با تهیه هر پک از تخفیف ویژه مجموعه بهره‌مند شوید و یک روتین کامل و سازگار با نوع پوست خود داشته باشید.
            </p>
            <div className={s.pills}>
              <span className={s.pill}>
                <Icon name="bolt" size={16} />
                تخفیف ویژه نسبت به خرید تکی
              </span>
              <span className={s.pill}>
                <Icon name="verified" size={16} />
                سازگاری کامل ترکیبات
              </span>
              <span className={s.pill}>
                <Icon name="local_shipping" size={16} />
                ارسال سریع به سراسر ایران
              </span>
            </div>
          </div>
          <div className={s.heroVisual}>
            <Image
              src="/images/packs-banner.png"
              alt="پک‌های کاربردی و روتین‌های مراقبتی آوینا"
              width={460}
              height={345}
              priority
              sizes="(min-width: 1024px) 440px, (min-width: 768px) 340px, 90vw"
              className={s.heroImg}
            />
          </div>
        </div>
      </header>

      {collections.length === 0 ? (
        <EmptyState icon="inventory_2" title="هنوز پکی فعال نشده است">
          پک‌های کاربردی و روتین‌های مراقبتی جدید به‌زودی به این بخش اضافه می‌شوند.
        </EmptyState>
      ) : (
        collections.map((c) => (
          <section key={c.slug} className={s.collectionSection} aria-labelledby={`col-${c.slug}`}>
            <div className={s.collectionHead}>
              <h2 id={`col-${c.slug}`} className={s.collectionTitle}>
                {c.title}
              </h2>
              {c.subtitle && <p className={s.collectionSubtitle}>{c.subtitle}</p>}
            </div>

            <div className={s.packsList}>
              {c.packs.map((p) => {
                const diff = p.final !== null ? p.total - p.final : 0;
                return (
                  <article key={p.key} className={s.packRowCard}>
                    <div className={s.cardHead}>
                      <div className={s.cardTitles}>
                        <span className={s.variantBadge}>{p.variantTitle}</span>
                        <h3 className={s.packTitle}>{p.title}</h3>
                      </div>
                      {p.saving > 0 && (
                        <span className={s.savingBadge}>{toFaDigits(p.saving)}٪ تخفیف پک</span>
                      )}
                    </div>

                    <div className={s.bundleBody} aria-label="محصولات موجود در این پک">
                      {p.steps.map((st, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && (
                            <span className={s.plusSeparator} aria-hidden="true">
                              +
                            </span>
                          )}
                          <div className={s.productTile}>
                            <div className={s.tileStage}>
                              <span className={s.pedestal} aria-hidden="true" />
                              {st.product?.imageUrl ? (
                                <div className={s.imageBox}>
                                  <Image
                                    src={st.product.imageUrl}
                                    alt={st.product.name}
                                    fill
                                    sizes="(min-width: 1024px) 160px, 130px"
                                    className={s.thumbImg}
                                  />
                                </div>
                              ) : (
                                <div className={s.noImage}>
                                  <Icon name="spa" size={28} />
                                </div>
                              )}
                            </div>
                            <div className={s.tileBody}>
                              <span className={s.tileStepBadge}>
                                {toFaDigits(i + 1)}. {st.label}
                              </span>
                              {st.product ? (
                                <>
                                  <h4 className={s.tileName} title={st.product.name}>
                                    {st.product.name}
                                  </h4>
                                  <span className={s.tilePrice}>
                                    {formatToman(st.product.priceToman)} تومان
                                  </span>
                                </>
                              ) : (
                                <span className={s.tileSoon}>به‌زودی</span>
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>

                    <div className={s.cardFooter}>
                      <div className={s.priceGroup}>
                        <div className={s.priceBox}>
                          {p.final !== null && p.total > p.final && (
                            <span className={s.oldPrice}>
                              جمع تکی: {formatToman(p.total)} تومان
                            </span>
                          )}
                          <span className={s.finalPrice}>
                            {p.final !== null ? (
                              <>
                                <span>قیمت پک:</span>
                                <b>{formatToman(p.final)}</b>
                                <span className={s.unit}>تومان</span>
                              </>
                            ) : (
                              <span style={{ fontSize: 14, color: 'var(--color-muted)' }}>
                                فعلاً در دسترس نیست
                              </span>
                            )}
                          </span>
                        </div>
                        {diff > 0 && (
                          <span className={s.savingNote}>
                            سود شما: {formatToman(diff)} تومان
                          </span>
                        )}
                      </div>

                      {p.available ? (
                        <Link href={p.href} className={s.viewButton}>
                          مشاهده و خرید پک
                          <Icon name="arrow_back" size={18} />
                        </Link>
                      ) : (
                        <span className={`${s.viewButton} ${s.disabledButton}`}>
                          ناموجود
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </Container>
  );
}
