'use client';

import { adminNavFor, type AdminCounts } from '@/lib/admin-nav';
import { PanelNav, type PanelNavItem } from '../../account/_ui/PanelNav';

/** The admin panel's menu: beside the page on desktop, a mobile hamburger bar + drawer on a phone. */
export function AdminNav({ isAdmin, counts }: { isAdmin: boolean; counts: AdminCounts }) {
  const items: PanelNavItem[] = adminNavFor(isAdmin).map((i) => ({
    href: i.href,
    label: i.label,
    icon: i.icon,
    count: i.count ? counts[i.count] : 0,
    exact: i.exact,
  }));

  return (
    <PanelNav
      title="پنل مدیریت"
      items={items}
      dataAttr="data-admin-nav"
      backToSiteHref="/"
      backToSiteLabel="مشاهده فروشگاه"
    />
  );
}
