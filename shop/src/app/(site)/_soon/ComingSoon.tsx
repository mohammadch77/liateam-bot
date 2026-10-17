import type { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { Breadcrumb, Button, Container, EmptyState } from '@/ui';
import s from '../_catalog/catalog.module.css';
import { COMING_SOON, type ComingSoonKey } from './sections';

/** Title for a placeholder page; never indexed (the real page will be). */
export function comingSoonMetadata(key: ComingSoonKey): Metadata {
  return {
    title: `${COMING_SOON[key].title} | ${getConfig().BRAND_NAME}`,
    robots: { index: false, follow: true },
  };
}

/**
 * «به‌زودی» page for a header/footer destination that is not built yet: the usual header and footer (site
 * layout), a polite message and the way back home. A real page with HTTP 200, so no link of the site leads to 404.
 */
export function ComingSoon({ section }: { section: ComingSoonKey }) {
  const { title, icon } = COMING_SOON[section];
  return (
    <Container className={s.page}>
      <Breadcrumb items={[{ label: 'خانه', href: '/' }, { label: title }]} />
      <EmptyState
        icon={icon}
        title={`${title}: به‌زودی`}
        action={
          <Button href="/" icon="home">
            بازگشت به صفحه‌ی اصلی
          </Button>
        }
      >
        این بخش به‌زودی در دسترس قرار می‌گیرد. تا آن زمان می‌توانید محصولات را ببینید و جست‌وجو کنید.
      </EmptyState>
    </Container>
  );
}
