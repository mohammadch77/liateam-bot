'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { toFaDigits } from '@/lib/format/number';
import { adminNavActive, adminNavFor, type AdminCounts } from '@/lib/admin-nav';
import { Icon } from '@/ui';
import s from '../../account/account.module.css';

/** The admin panel's menu: beside the page on desktop, a row of tabs on a phone; a number marks what is waiting. */
export function AdminNav({ isAdmin, counts }: { isAdmin: boolean; counts: AdminCounts }) {
  const path = usePathname();
  return (
    <nav className={s.nav} aria-label="منوی مدیریت" data-admin-nav>
      {adminNavFor(isAdmin).map((i) => {
        const n = i.count ? counts[i.count] : 0;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={s.navLink}
            aria-current={adminNavActive(i, path) ? 'page' : undefined}
            data-admin-nav-item={i.href}
          >
            <Icon name={i.icon} size={20} />
            {i.label}
            {n > 0 && (
              <span className={s.navBadge} data-nav-count={n} aria-label={`${toFaDigits(n)} مورد`}>
                {toFaDigits(n > 99 ? 99 : n)}
                {n > 99 ? '+' : ''}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
