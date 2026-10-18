import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { toFaDigits } from '@/lib/format/number';
import { getCurrentUser } from '@/server/services/session.service';
import {
  AFFILIATE_POLICY,
  CHANNEL_TYPES,
  FOLLOWERS,
  PROVINCES,
  affiliateService,
} from '@/server/services/affiliate.service';
import { Alert, Breadcrumb, Button, Container, Icon, type IconName } from '@/ui';
import { AffiliateForm } from './AffiliateForm';
import s from './affiliate.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `همکاری در فروش | ${brand}`,
    description: `فروشنده‌ی همکار ${brand} شوید: محصولات اصل آرایشی و بهداشتی را در پیج یا فروشگاه خود بفروشید.`,
    alternates: { canonical: '/affiliate' },
  };
}

const BENEFITS: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'verified',
    title: 'کالای اصل، مستقیم از تأمین‌کننده',
    text: 'با خیال راحت معرفی کنید؛ اصالت همه‌ی کالاها تضمین است.',
  },
  {
    icon: 'local_shipping',
    title: 'بدون انبار و ارسال',
    text: 'سفارش مشتری شما را ما بسته‌بندی و به سراسر ایران ارسال می‌کنیم.',
  },
  {
    icon: 'account_balance_wallet',
    title: 'درآمد از هر فروش',
    text: 'پورسانت هر سفارش به کیف پول شما می‌رود (به‌زودی).',
  },
];
const STEPS = ['فرم درخواست را پر کنید', 'درخواست شما را بررسی می‌کنیم', 'همکاری را شروع کنید'];

const dateFa = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium' });
const SOURCES = new Set(['home', 'footer', 'account']);

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** «همکاری در فروش»: a short introduction and the application (signed-in users; one pending at a time). */
export default async function AffiliatePage({ searchParams }: Props) {
  const from = (await searchParams).from;
  const source = typeof from === 'string' && SOURCES.has(from) ? from : 'direct';
  const user = await getCurrentUser();
  const status = user ? await affiliateService.statusFor(user) : null;
  const here = source === 'direct' ? '/affiliate' : `/affiliate?from=${source}`;

  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: 'همکاری در فروش' }]} />

      <section className={s.intro} aria-labelledby="affiliate-title">
        <div className={s.introText}>
          <span className={s.kicker}>
            <span className={s.kickerDot} aria-hidden="true" />
            همکاری در فروش
          </span>
          <h1 id="affiliate-title" className={s.title}>
            با پیج یا فروشگاهت، <span className={s.accent}>فروشنده‌ی همکار</span> ما شو
          </h1>
          <p className={s.lead}>
            محصولات اصل آرایشی و بهداشتی را به مخاطبانت معرفی کن؛ موجودی، بسته‌بندی و ارسال با ما.
          </p>
          <ol className={s.steps}>
            {STEPS.map((t, i) => (
              <li key={t}>
                <span className={s.stepNum} aria-hidden="true">
                  {toFaDigits(i + 1)}
                </span>
                {t}
              </li>
            ))}
          </ol>
        </div>
        <ul className={s.benefits}>
          {BENEFITS.map((b) => (
            <li key={b.title} className={s.benefit}>
              <span className={s.benefitIcon}>
                <Icon name={b.icon} size={24} />
              </span>
              <span>
                <b className={s.benefitTitle}>{b.title}</b>
                <span className={s.benefitText}>{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.card} aria-label="درخواست همکاری">
        {!user || !status ? (
          <div className={s.guest}>
            <h2 className={s.formTitle}>برای ثبت درخواست وارد شوید</h2>
            <p className={s.muted}>
              ورود فقط با شماره موبایل و کد تأیید است؛ درخواست به همان شماره ثبت می‌شود.
            </p>
            <Button href={`/login?next=${encodeURIComponent(here)}`} icon="person">
              ورود و ثبت درخواست
            </Button>
          </div>
        ) : status.kind === 'affiliate' || status.kind === 'approved' ? (
          <Alert tone="success">
            شما فروشنده‌ی همکار هستید. امکانات پنل همکاری به‌زودی در حساب کاربری‌تان فعال می‌شود.
          </Alert>
        ) : status.kind === 'pending' ? (
          <div role="status" className={s.done}>
            <Alert tone="success">
              درخواستت ثبت شد و در حال بررسی است (ثبت‌شده در {dateFa.format(status.application.created_at)}).
            </Alert>
          </div>
        ) : status.kind === 'rejected' && !status.canRetry ? (
          <Alert tone="warning">
            درخواست قبلی شما تأیید نشد
            {status.application.reject_reason ? `: ${status.application.reject_reason}` : '.'} از{' '}
            {dateFa.format(status.retryAt)} می‌توانید دوباره درخواست بدهید.
          </Alert>
        ) : (
          <AffiliateForm
            fullName={user.fullName ?? ''}
            phone={toFaDigits(user.phone)}
            source={source}
            provinces={PROVINCES}
            channels={Object.entries(CHANNEL_TYPES).map(([value, label]) => ({ value, label }))}
            followers={Object.entries(FOLLOWERS).map(([value, label]) => ({ value, label }))}
            descriptionMax={AFFILIATE_POLICY.descriptionMax}
          />
        )}
      </section>
    </Container>
  );
}
