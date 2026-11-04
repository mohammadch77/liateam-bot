import type { ReactNode } from 'react';
import { NO_COUNTS } from '@/lib/admin-nav';
import { adminNavService } from '@/server/services/admin-nav.service';
import { getCurrentUser, hasRole } from '@/server/services/session.service';
import { Container } from '@/ui';
import s from '../account/account.module.css';
import { BackButton } from '../account/_ui/BackButton';
import { AdminNav } from './_ui/AdminNav';

/**
 * Every page under /admin: the menu beside (desktop) or above (a phone) the page. The pages guard themselves (a customer gets 403
 * there); the menu is only drawn for the staff, and the numbers are read only for them.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const staff = !!user && hasRole(user, 'support');
  if (!staff) return <>{children}</>;
  const isAdmin = hasRole(user, 'admin');
  const counts = await adminNavService.counts(isAdmin).catch(() => NO_COUNTS);
  return (
    <Container className={s.shell}>
      <AdminNav isAdmin={isAdmin} counts={counts} />
      <div className={s.main}>
        <BackButton root="/admin" />
        {children}
      </div>
    </Container>
  );
}
