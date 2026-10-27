import type { ReactNode } from 'react';
import {
  bottomNavItems,
  footerProps,
  headerBrands,
  headerCampaign,
  headerCategories,
  headerProps,
} from '@/server/site/chrome';
import { freeShippingFrom } from '@/lib/shipping';
import { orderSettingsService } from '@/server/services/order-settings.service';
import { getCurrentUser } from '@/server/services/session.service';
import { BottomNav, BottomNavSpacer, Footer, Header } from '@/ui';

// Header shows the signed-in state and live categories, so storefront pages are rendered per request.
export const dynamic = 'force-dynamic';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [user, categories, brands, campaign, settings] = await Promise.all([
    getCurrentUser(),
    headerCategories(),
    headerBrands(),
    headerCampaign(),
    orderSettingsService.get(),
  ]);
  return (
    <>
      <Header {...headerProps(user, categories, brands, campaign, freeShippingFrom(settings.freeShipping))} />
      <main>{children}</main>
      <Footer {...footerProps()} />
      <BottomNavSpacer />
      <BottomNav items={bottomNavItems(user)} />
    </>
  );
}
