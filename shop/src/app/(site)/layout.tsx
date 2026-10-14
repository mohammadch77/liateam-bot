import type { ReactNode } from 'react';
import { bottomNavItems, footerProps, headerProps } from '@/server/site/chrome';
import { getCurrentUser } from '@/server/services/session.service';
import { BottomNav, BottomNavSpacer, Footer, Header } from '@/ui';

// Header shows the signed-in state, so storefront pages are rendered per request.
export const dynamic = 'force-dynamic';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <Header {...headerProps(user)} />
      <main>{children}</main>
      <Footer {...footerProps()} />
      <BottomNavSpacer />
      <BottomNav items={bottomNavItems(user)} />
    </>
  );
}
