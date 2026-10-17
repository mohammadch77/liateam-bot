import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { formatToman } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { getConfig } from '@/lib/config';
import {
  Alert,
  AddToCartButton,
  Badge,
  BottomNav,
  BottomNavSpacer,
  Breadcrumb,
  Button,
  Checkbox,
  Container,
  DiscountRibbon,
  DiscountTag,
  EmptyState,
  FavoriteButton,
  FilterChip,
  Footer,
  Header,
  Icon,
  Pagination,
  Price,
  ProductCard,
  ProductCardSkeleton,
  ProductGrid,
  Saving,
  SealPlaceholder,
  Section,
  Select,
  Skeleton,
  Switch,
  TextField,
  breakpoints,
  color,
  control,
  motion,
  radius,
  shadow,
  space,
  type,
  type ColorToken,
} from '@/ui';
import { bottomNav, cards, footer, header } from './samples';
import s from './styleguide.module.css';

// Rendered per request: the production guard must read the runtime environment, and `next build` on the
// server runs without the env file (config is only loaded at runtime).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'شیوه‌نامه طراحی', robots: { index: false, follow: false } };

const CORE: Array<[ColorToken, string, string]> = [
  ['ink', 'جوهر', 'متن اصلی، فوتر · ۱۶٫۴:۱'],
  ['ink-2', 'جوهر ۲', 'متن ثانویه · ۹٫۲:۱'],
  ['muted', 'خاموش', 'متادیتا · ۵٫۴:۱'],
  ['surface', 'سطح', 'پس‌زمینه صفحه'],
  ['surface-2', 'سطح ۲', 'فیلد جست‌وجو، تب'],
  ['blush', 'رژگونه', 'بخش‌ها، هاور'],
  ['primary', 'بِری ۷۰۰', 'CTA، تخفیف · ۹٫۰:۱'],
  ['primary-hover', 'بِری ۸۰۰', 'هاور'],
  ['primary-press', 'بِری ۹۰۰', 'فشرده'],
  ['accent', 'رزگلد', 'فقط تزئینی · ۲٫۶:۱'],
  ['accent-text', 'رزگلد تیره', 'نام برند · ۴٫۸:۱'],
  ['line', 'خط', 'حاشیه کارت'],
  ['success', 'موفقیت', 'موجود · ۵٫۳:۱'],
  ['success-50', 'موفقیت روشن', 'زمینه نشان'],
  ['warning', 'هشدار', 'موجودی محدود · ۶٫۹:۱'],
  ['warning-50', 'هشدار روشن', 'زمینه نشان'],
  ['danger', 'خطا', 'خطای فرم · ۶٫۵:۱'],
  ['danger-50', 'خطا روشن', 'زمینه هشدار'],
];
const DARK_TEXT = new Set<ColorToken>([
  'ink',
  'ink-2',
  'muted',
  'primary',
  'primary-hover',
  'primary-press',
  'accent-text',
  'success',
  'warning',
  'danger',
]);
const CORE_SET = new Set(CORE.map(([t]) => t));

/** Internal page: available in development and staging only. */
export default function StyleguidePage() {
  if (getConfig().APP_ENV === 'production') notFound();

  return (
    <>
      <Header {...header} />
      <main className={s.page}>
        <Container>
          <div className={s.intro}>
            <span className={s.kicker}>آوینا · جهت ۱ — Luxe Market</span>
            <h1 className={s.title}>شیوه‌نامه طراحی</h1>
            <p className={s.lead}>
              یک فونت برای کل رابط: <b>Vazirmatn</b> (۳۰۰ تا ۹۰۰). تیترها ۸۰۰ با فاصله حروف منفی، اعداد قیمت
              با ارقام هم‌عرض (tnum) و واحد «تومان» کوچک‌تر. همه‌ی مقادیر از <code>src/ui/tokens.ts</code>{' '}
              می‌آیند.
            </p>
          </div>

          <Panel title="رنگ‌ها" id="colors">
            <div className={s.swatches}>
              {CORE.map(([token, name, use]) => (
                <div key={token} className={s.swatch}>
                  <div className={s.swatchColor} style={{ background: color[token] }}>
                    <span
                      style={{
                        color: DARK_TEXT.has(token) ? '#fff' : token === 'blush' ? color.primary : color.ink,
                      }}
                    >
                      آوینا
                    </span>
                  </div>
                  <div className={s.swatchMeta}>
                    <b>{name}</b>
                    <code className={s.code}>
                      {token} · {color[token]}
                    </code>
                    <span className={s.note}>{use}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className={s.note}>
              رزگلد خالص فقط تزئینی است؛ برای متن از رزگلد تیره استفاده می‌شود. تخفیف همیشه بِری است، نه قرمز
              هشدار.
            </p>
            <details className={s.more}>
              <summary>رنگ‌های سطح کامپوننت (از فایل‌های طرح)</summary>
              <div className={s.chips}>
                {(Object.keys(color) as ColorToken[])
                  .filter((t) => !CORE_SET.has(t))
                  .map((t) => (
                    <span key={t} className={s.miniSwatch}>
                      <span className={s.miniDot} style={{ background: color[t] }} />
                      <code className={s.code}>
                        {t} {color[t]}
                      </code>
                    </span>
                  ))}
              </div>
            </details>
          </Panel>

          <div className={s.twoCol}>
            <Panel title="مقیاس تایپوگرافی" id="type">
              {(Object.entries(type) as Array<[string, (typeof type)[keyof typeof type]]>).map(([k, t]) => (
                <div key={k} className={s.typeRow}>
                  <span className={s.typeMeta}>
                    <b>{t.label}</b>
                    <code className={s.code}>
                      {t.size}/{t.line} · {t.weight}
                      {t.tracking ? ` · ${t.tracking}` : ''}
                    </code>
                  </span>
                  <span
                    className={s.typeSample}
                    style={{
                      fontSize: t.size,
                      lineHeight: t.line,
                      fontWeight: t.weight,
                      letterSpacing: t.tracking,
                    }}
                  >
                    {k === 'price' ? `${formatToman(189_500)} تومان` : TYPE_SAMPLES[k]}
                  </span>
                </div>
              ))}
            </Panel>

            <Panel title="فاصله، گوشه، سایه، حرکت" id="space">
              <b className={s.sub}>فاصله‌ها (پایه ۴)</b>
              <div className={s.spaceRow}>
                {Object.values(space).map((n) => (
                  <span key={n} className={s.spaceItem}>
                    <span
                      className={s.spaceBox}
                      style={{ width: Math.min(n, 56), height: Math.min(n, 56) }}
                    />
                    <span className={s.note}>{formatNumber(n)}</span>
                  </span>
                ))}
              </div>
              <b className={s.sub}>گوشه‌ها</b>
              <div className={s.radiusRow}>
                {(Object.entries(radius) as Array<[string, number]>).map(([k, r]) => (
                  <span key={k} className={s.spaceItem}>
                    <span className={s.radiusBox} style={{ borderRadius: r }} />
                    <span className={s.note}>
                      {k} {r === 999 ? 'کپسولی' : formatNumber(r)}
                    </span>
                  </span>
                ))}
              </div>
              <b className={s.sub}>سایه‌ها</b>
              <div className={s.radiusRow}>
                {(Object.entries(shadow) as Array<[string, string]>)
                  .filter(([k]) => k !== 'focus-field')
                  .map(([k, v]) => (
                    <span key={k} className={s.spaceItem}>
                      <span className={s.shadowBox} style={{ boxShadow: v }} />
                      <span className={s.note}>{k}</span>
                    </span>
                  ))}
              </div>
              <b className={s.sub}>حرکت و ارتفاع کنترل‌ها</b>
              <p className={s.note}>
                {motion.fast} هاور، فشردن · {motion.base} کارت، تب · {motion.slow} مگامنو · ease {motion.ease}{' '}
                · ارتفاع: {control.lg} (CTA اصلی) · {control.md} (پیش‌فرض) · {control.sm} (حداقل لمسی)
              </p>
            </Panel>
          </div>

          <Panel title="نقاط شکست و شبکه" id="breakpoints">
            <div className={s.bps}>
              {Object.entries(breakpoints).map(([k, b]) => (
                <div key={k} className={s.bp}>
                  <b>{formatNumber(b.min === 0 ? 360 : b.min)}+</b>
                  <div className={s.bpGrid} style={{ gridTemplateColumns: `repeat(${b.columns}, 1fr)` }}>
                    {Array.from({ length: b.columns }, (_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                  <span className={s.note}>
                    {formatNumber(b.columns)} ستون · حاشیه {formatNumber(b.gutter)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="دکمه‌ها" id="buttons">
            <div className={s.buttons}>
              <Button>افزودن به سبد</Button>
              <Button size="lg">ادامه فرایند خرید</Button>
              <Button disabled>ناموجود</Button>
              <Button loading loadingText="در حال افزودن…">
                افزودن به سبد
              </Button>
              <Button variant="outline">مشاهده همه</Button>
              <Button variant="outline" disabled>
                مشاهده همه
              </Button>
              <Button variant="outline" loading loadingText="صبر کنید">
                ثبت
              </Button>
              <Button variant="ghost" iconEnd="arrow_back">
                ادامه
              </Button>
              <Button variant="ghost" disabled>
                ادامه
              </Button>
              <Button variant="dark" icon="refresh" size="sm">
                تلاش دوباره
              </Button>
              <Button href="/styleguide#cards" variant="outline" size="sm">
                لینک به شکل دکمه
              </Button>
            </div>
            <p className={s.note}>
              ارتفاع ۵۲ / ۴۸ / ۴۴ · حلقه فوکوس ۲px بِری با فاصله ۳px، فقط با کیبورد (Tab بزنید). هاور و فشردن
              را با ماوس ببینید.
            </p>
          </Panel>

          <div className={s.twoCol}>
            <Panel title="ورودی‌ها" id="inputs">
              <div className={s.fields}>
                <TextField label="نام و نام خانوادگی" labelNote="پیش‌فرض" placeholder="مثلاً نگار محمدی" />
                <TextField
                  label="شماره موبایل"
                  ltr
                  inputMode="numeric"
                  defaultValue="۰۹۱۲ ۳۴۵ ۶۷۸۹"
                  hint="کد تأیید به این شماره پیامک می‌شود."
                />
                <TextField
                  label="کد پستی"
                  labelNote="خطا"
                  defaultValue="۱۲۳۴۵"
                  error="کد پستی باید ۱۰ رقم باشد."
                />
                <TextField label="کد ملی" labelNote="غیرفعال" defaultValue="۰۰۱۲۳۴۵۶۷۸" disabled />
                <Select
                  label="شهر"
                  options={[
                    { value: 'thr', label: 'تهران' },
                    { value: 'isf', label: 'اصفهان' },
                    { value: 'shz', label: 'شیراز' },
                  ]}
                />
                <Select
                  label="مرتب‌سازی"
                  options={[
                    { value: 'popular', label: 'پرفروش‌ترین' },
                    { value: 'cheap', label: 'ارزان‌ترین' },
                    { value: 'new', label: 'جدیدترین' },
                  ]}
                />
              </div>
              <b className={s.sub}>فیلترها</b>
              <div className={s.filters}>
                <Checkbox defaultChecked count={24}>
                  تراست
                </Checkbox>
                <Checkbox count={18}>سرج</Checkbox>
                <Checkbox disabled count={0}>
                  لایف گارد
                </Checkbox>
                <Switch defaultChecked>فقط کالاهای موجود</Switch>
              </div>
              <div className={s.filters}>
                <FilterChip removeHref="/styleguide#inputs">برند: تراست</FilterChip>
                <FilterChip removeHref="/styleguide#inputs">تا ۳۰۰ هزار تومان</FilterChip>
              </div>
            </Panel>

            <Panel title="نشان‌ها و قیمت" id="badges">
              <div className={s.badges}>
                <DiscountRibbon percent={20} />
                <DiscountTag percent={15} />
                <Badge tone="limited" />
                <Badge tone="outOfStock" />
                <Badge tone="inStock" />
                <Badge tone="genuine" />
                <Badge tone="new" />
                <Badge tone="neutral" icon="local_shipping">
                  ارسال رایگان
                </Badge>
                <Badge tone="soon" />
                <FavoriteButton />
                <FavoriteButton on />
                <AddToCartButton state="idle" />
                <AddToCartButton state="loading" />
                <AddToCartButton state="done" />
              </div>
              <b className={s.sub}>نمایش قیمت (همه‌ی مبالغ به تومان)</b>
              <div className={s.prices}>
                <Price toman={189_500} oldToman={237_000} size="lg" />
                <Price toman={58_000} oldToman={64_000} />
                <Price toman={977_000} size="sm" />
                <Saving toman={189_500} oldToman={237_000} />
              </div>
              <p className={s.note} data-testid="price-check">
                ۹۷۷۰۰۰ ← {formatToman(977_000)} تومان
              </p>
            </Panel>
          </div>

          <Panel title="کارت محصول — حالت‌ها" id="cards">
            <ProductGrid>
              {cards.map((c) => (
                <div key={c.label} className={s.cardCell}>
                  <span className={s.note}>{c.label}</span>
                  <ProductCard
                    product={c.product}
                    favorite={c.state === 'fav' ? <FavoriteButton on /> : undefined}
                    action={
                      c.state === 'loading' || c.state === 'done' ? (
                        <AddToCartButton state={c.state} />
                      ) : undefined
                    }
                  />
                </div>
              ))}
              <div className={s.cardCell}>
                <span className={s.note}>اسکلتون</span>
                <ProductCardSkeleton />
              </div>
            </ProductGrid>
          </Panel>

          <Section title="پرفروش‌ترین‌ها" action={{ href: '/styleguide#cards', label: 'مشاهده همه' }}>
            <ProductGrid>
              {cards.slice(0, 5).map((c) => (
                <ProductCard key={c.label} product={c.product} />
              ))}
            </ProductGrid>
          </Section>

          <div className={s.twoCol}>
            <Panel title="مسیر و صفحه‌بندی" id="nav">
              <Breadcrumb
                items={[
                  { label: 'آوینا', href: '/styleguide' },
                  { label: 'مراقبت پوست', href: '/c/skin' },
                  { label: 'ضدآفتاب رنگی', href: '/c/skin/sunscreen' },
                  { label: 'کرم ضدآفتاب رنگی SPF50 سرج' },
                ]}
              />
              <Pagination page={5} totalPages={12} hrefFor={(n) => `/styleguide?page=${n}#nav`} />
              <Pagination page={1} totalPages={3} hrefFor={(n) => `/styleguide?page=${n}#nav`} />
            </Panel>
            <Panel title="بارگذاری" id="loading">
              <div className={s.skeletons}>
                <Skeleton width="40%" height={14} />
                <Skeleton width="90%" />
                <Skeleton width="70%" />
                <Skeleton height={120} radius={14} />
              </div>
            </Panel>
          </div>

          <Panel title="حالت‌های خالی، خطا و بازخورد" id="feedback">
            <div className={s.feedback}>
              <EmptyState
                icon="shopping_bag"
                title="سبد خرید شما خالی است"
                action={<Button size="sm">رفتن به فروشگاه</Button>}
              >
                پیشنهادهای شگفت‌انگیز امروز را ببینید.
              </EmptyState>
              <EmptyState
                icon="search_off"
                tone="neutral"
                title="محصولی با این فیلترها نیست"
                action={
                  <Button size="sm" variant="outline">
                    پاک کردن فیلترها
                  </Button>
                }
              >
                بازه قیمت را بزرگ‌تر کنید یا «فقط موجود» را بردارید.
              </EmptyState>
              <EmptyState
                icon="wifi_off"
                tone="danger"
                title="ارتباط برقرار نشد"
                action={
                  <Button size="sm" variant="dark" icon="refresh">
                    تلاش دوباره
                  </Button>
                }
              >
                اتصال اینترنت را بررسی کنید؛ سبد شما محفوظ است.
              </EmptyState>
              <div className={s.alerts}>
                <Alert tone="success" action={<a href="#cards">مشاهده</a>}>
                  به سبد خرید افزوده شد
                </Alert>
                <Alert tone="warning">تعداد این کالا به ۲ عدد کاهش یافت؛ موجودی انبار تغییر کرده است.</Alert>
                <Alert tone="danger">پرداخت ناموفق بود؛ مبلغ کسرشده تا ۷۲ ساعت بازمی‌گردد.</Alert>
              </div>
            </div>
          </Panel>

          <p className={s.note}>
            <Icon name="verified" size={16} style={{ display: 'inline', verticalAlign: 'middle' }} /> هدر،
            فوتر و ناوبری پایین (موبایل) همین صفحه، نمونه‌ی زنده‌ی کامپوننت‌ها هستند.
          </p>
        </Container>
      </main>
      <Footer
        {...footer}
        seals={
          <>
            <SealPlaceholder label="نماد اعتماد الکترونیکی" />
            <SealPlaceholder label="نشان ساماندهی" />
          </>
        }
      />
      <BottomNavSpacer />
      <BottomNav items={bottomNav} />
    </>
  );
}

const TYPE_SAMPLES: Record<string, string> = {
  display: 'درخشش اصیل',
  h1: 'پیشنهاد شگفت‌انگیز',
  section: 'پرفروش‌ترین‌ها',
  h2: 'پرفروش‌ترین‌ها',
  h3: 'ویژگی‌های کلیدی محصول',
  'body-lg': 'سرم‌ها و ضدآفتاب‌های منتخب از برندهای معتبر',
  body: 'بافت ژل‌کرمی فاقد چربی؛ سفیدک نمی‌گذارد.',
  small: 'ارسال از انبار تهران',
  caption: 'موجودی محدود · ۴ عدد',
};

function Panel({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className={s.panel} id={id} aria-labelledby={`${id}-h`}>
      <h2 className={s.panelTitle} id={`${id}-h`}>
        {title}
      </h2>
      {children}
    </section>
  );
}
