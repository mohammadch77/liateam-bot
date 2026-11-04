import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { Breadcrumb, Container } from '@/ui';
import { getCurrentUser } from '@/server/services/session.service';
import { affiliateService } from '@/server/services/affiliate.service';
import { AffiliateApply, AffiliateIntro } from './AffiliateSections';
import s from './affiliate.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const brand = getConfig().BRAND_NAME;
  return {
    title: `همکاری در فروش | ${brand}`,
    description: `فروشنده‌ی همکار ${brand} شوید: محصولات اصل آرایشی و بهداشتی را در پیج یا فروشگاه خود بفروشید.`,
    alternates: { canonical: '/affiliate' },
  };
}

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

      <AffiliateIntro />
      <AffiliateApply user={user} status={status} source={source} here={here} />
    </Container>
  );
}
