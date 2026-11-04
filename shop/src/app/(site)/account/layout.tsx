import type { ReactNode } from 'react';
import { Container } from '@/ui';
import { AccountNav } from './_ui/AccountNav';
import { BackButton } from './_ui/BackButton';
import s from './account.module.css';

/** Every page under /account: the menu beside (desktop) or above (mobile) the page itself. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <Container className={s.shell}>
      <AccountNav />
      <div className={s.main}>
        <BackButton root="/account" />
        {children}
      </div>
    </Container>
  );
}
