'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@/ui';
import s from '../account.module.css';

/** The parent of a panel page: the address without its last segment (never above the panel's root). */
export function parentPath(path: string, root: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  parts.pop();
  const up = parts.join('/');
  return up.length >= root.length && up.startsWith(root) ? up : root;
}

/**
 * «بازگشت» on every panel page except the panel's own root. It goes back in the history when the previous page is this site's (so
 * the customer lands where they came from), else to the parent page. A real link, so it also works by keyboard and without scripts.
 */
export function BackButton({ root }: { root: string }) {
  const path = usePathname();
  const router = useRouter();
  if (path === root || path === `${root}/`) return null;
  const parent = parentPath(path, root);
  return (
    <Link
      href={parent}
      className={s.back}
      data-back
      onClick={(e) => {
        const here = window.location.origin;
        if (window.history.length > 1 && document.referrer.startsWith(here)) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      <Icon name="arrow_forward" size={18} />
      بازگشت
    </Link>
  );
}
