import type { ReactNode } from 'react';
import { getCurrentUser } from '@/server/services/session.service';
import { Container } from '@/ui';
import { AccountNav } from './_ui/AccountNav';
import { BackButton } from './_ui/BackButton';
import s from './account.module.css';

/** Every page under /account: the menu beside (desktop) or above (mobile) the page itself. */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <Container className={s.shell}>
      <AccountNav affiliate={!!user?.roles.includes('affiliate')} />
      <div className={s.main}>
        <BackButton root="/account" />
        {children}
      </div>
    </Container>
  );
}
