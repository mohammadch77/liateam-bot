import type { PurchaseProgress, SalesTierProgress } from '@/lib/affiliate/tiers';
import { formatToman } from '@/lib/format/money';
import { toFaDigits } from '@/lib/format/number';
import { Button, Icon } from '@/ui';
import p from './affiliate-progress.module.css';

/** Shown to regular customers before applying for affiliate status: locks form until monthly personal purchase target is reached. */
export function EligibilityGateCard({ eligibility }: { eligibility: PurchaseProgress }) {
  return (
    <section className={p.card} aria-labelledby="elig-title" data-affiliate-eligibility>
      <div className={p.head}>
        <div className={p.titleWrap}>
          <span className={p.iconBadge} aria-hidden="true">
            <Icon name={eligibility.met ? 'check_circle' : 'shopping_bag'} size={20} />
          </span>
          <div>
            <h2 id="elig-title" className={p.title}>
              شرط ورود به همکاری در فروش
            </h2>
            <p className={p.sub}>میزان خرید شخصی شما در ۳۰ روز اخیر (به‌عنوان مشتری عادی)</p>
          </div>
        </div>
        <div className={p.pills}>
          <span className={`${p.pill} ${eligibility.met ? p.pillSuccess : p.pillWarn}`}>
            {eligibility.met ? 'واجد شرایط درخواست' : 'در حال تکمیل سقف خرید'}
          </span>
          {eligibility.isCustom && <span className={`${p.pill} ${p.pillNeutral}`}>سقف اختصاصی شما</span>}
        </div>
      </div>

      <div className={p.barMeta}>
        <span>
          <span className={p.barAmount}>{formatToman(eligibility.currentToman)} تومان</span>{' '}
          <span className={p.barTarget}>از {formatToman(eligibility.requiredToman)} تومان</span>
        </span>
        <span className={p.barPercent}>{toFaDigits(eligibility.percent)}٪</span>
      </div>

      <div
        className={p.track}
        role="progressbar"
        aria-valuenow={eligibility.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="پیشرفت خرید شخصی ماهانه برای همکاری در فروش"
      >
        <div
          className={`${p.fill} ${eligibility.met ? p.fillDone : ''}`}
          style={{ width: `${eligibility.percent}%` }}
        />
      </div>

      <div className={p.footRow}>
        {eligibility.met ? (
          <p className={p.hint}>
            تبریک! شما به سقف خرید ماهانه رسیده‌اید و اکنون می‌توانید فرم درخواست همکاری در فروش را تکمیل کنید.
          </p>
        ) : (
          <>
            <p className={p.hint}>
              برای باز شدن فرم درخواست همکاری در فروش، فقط{' '}
              <b>{formatToman(eligibility.remainingToman)} تومان</b> دیگر از فروشگاه خرید شخصی داشته باشید.
            </p>
            <Button href="/shop" size="sm" icon="shopping_bag">
              مشاهده محصولات فروشگاه
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/** Shown to active affiliates: monthly personal purchase maintenance quota as a regular customer. */
export function AffiliateMaintenanceCard({ maintenance }: { maintenance: PurchaseProgress }) {
  return (
    <section className={p.card} aria-labelledby="maint-title" data-affiliate-maintenance>
      <div className={p.head}>
        <div className={p.titleWrap}>
          <span className={p.iconBadge} aria-hidden="true">
            <Icon name={maintenance.met ? 'verified' : 'shopping_bag'} size={20} />
          </span>
          <div>
            <h2 id="maint-title" className={p.title}>
              حداقل خرید شخصی ماهانه (تداوم همکاری)
            </h2>
            <p className={p.sub}>
              برای فعال ماندن و دریافت پورسانت، حداقل خرید شخصی خود را در هر دوره ۳۰ روزه تکمیل کنید
            </p>
          </div>
        </div>
        <div className={p.pills}>
          <span className={`${p.pill} ${maintenance.met ? p.pillSuccess : p.pillWarn}`}>
            {maintenance.met ? 'سهمیه این ماه تکمیل است' : 'نیاز به تکمیل خرید شخصی'}
          </span>
          {maintenance.isCustom && <span className={`${p.pill} ${p.pillNeutral}`}>تنظیم اختصاصی</span>}
        </div>
      </div>

      <div className={p.barMeta}>
        <span>
          <span className={p.barAmount}>{formatToman(maintenance.currentToman)} تومان</span>{' '}
          <span className={p.barTarget}>
            {maintenance.requiredToman > 0
              ? `از ${formatToman(maintenance.requiredToman)} تومان`
              : '(بدون حداقل الزامی)'}
          </span>
        </span>
        <span className={p.barPercent}>{toFaDigits(maintenance.percent)}٪</span>
      </div>

      <div
        className={p.track}
        role="progressbar"
        aria-valuenow={maintenance.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="پیشرفت حداقل خرید شخصی ماهانه همکار"
      >
        <div
          className={`${p.fill} ${maintenance.met ? p.fillDone : ''}`}
          style={{ width: `${maintenance.percent}%` }}
        />
      </div>

      {!maintenance.met && (
        <div className={p.footRow}>
          <p className={p.hint}>
            برای تداوم دریافت پورسانت این ماه، <b>{formatToman(maintenance.remainingToman)} تومان</b> دیگر خرید
            شخصی ثبت کنید.
          </p>
          <Button href="/shop" size="sm" variant="outline" icon="shopping_bag">
            خرید از فروشگاه
          </Button>
        </div>
      )}
    </section>
  );
}

/** Shown to active affiliates: stepped progressive bar of monthly referred sales & dynamic commission percentage. */
export function AffiliateTiersCard({ sales }: { sales: SalesTierProgress }) {
  return (
    <section className={p.card} aria-labelledby="tiers-title" data-affiliate-tiers>
      <div className={p.head}>
        <div className={p.titleWrap}>
          <span className={p.iconBadge} aria-hidden="true">
            <Icon name="trending_up" size={20} />
          </span>
          <div>
            <h2 id="tiers-title" className={p.title}>
              سطح فروش و پلکان درصد پورسانت
            </h2>
            <p className={p.sub}>با افزایش فروش ماهانه از طریق لینک شما، درصد دریافتی شما به صورت پلکانی ارتقا می‌یابد</p>
          </div>
        </div>
        <div className={p.pills}>
          {sales.currentTier && (
            <span className={`${p.pill} ${p.pillBrand}`}>
              سطح فعلی: {sales.currentTier.title} ({toFaDigits(sales.currentCommissionPercent)}٪)
            </span>
          )}
          {sales.isCustom && <span className={`${p.pill} ${p.pillNeutral}`}>پلکان اختصاصی</span>}
        </div>
      </div>

      <div className={p.tierSummary}>
        <div className={p.tierStat}>
          <span>فروش ماهانه معرفی‌شده‌ها</span>
          <b>{formatToman(sales.monthlySalesToman)} تومان</b>
        </div>
        <div className={`${p.tierStat} ${p.tierStatHighlight}`}>
          <span>درصد پورسانت فعلی شما</span>
          <b>{toFaDigits(sales.currentCommissionPercent)}٪</b>
        </div>
        <div className={p.tierStat}>
          <span>{sales.nextTier ? `تا سطح بعدی (${sales.nextTier.title})` : 'وضعیت سطح'}</span>
          <b>
            {sales.nextTier
              ? `${formatToman(sales.remainingToNextToman)} تومان`
              : 'بالاترین سطح فعال است'}
          </b>
        </div>
      </div>

      <div
        className={p.track}
        role="progressbar"
        aria-valuenow={sales.overallPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="پیشرفت پلکانی سطح فروش همکار"
      >
        <div className={p.fill} style={{ width: `${sales.overallPercent}%` }} />
      </div>

      <ol className={p.stepsGrid} aria-label="پله‌های سطح فروش">
        {sales.tiers.map((tier, idx) => {
          const isCurrent = idx === sales.currentIndex;
          const isDone = idx < sales.currentIndex;
          return (
            <li
              key={`${tier.title}-${tier.minSalesToman}`}
              className={`${p.stepCard} ${isCurrent ? p.stepCurrent : isDone ? p.stepDone : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className={p.stepTop}>
                <span className={p.stepBadge} aria-hidden="true">
                  {isDone ? <Icon name="check" size={13} /> : toFaDigits(idx + 1)}
                </span>
                <span className={p.stepPct}>{toFaDigits(tier.commissionPercent)}٪</span>
              </div>
              <span className={p.stepTitle}>{tier.title}</span>
              <span className={p.stepMin}>
                {tier.minSalesToman === 0
                  ? 'شروع همکاری'
                  : `از ${formatToman(tier.minSalesToman)} تومان`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
