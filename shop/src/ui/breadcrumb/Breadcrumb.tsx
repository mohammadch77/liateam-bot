import Link from 'next/link';
import { Fragment } from 'react';
import { Icon } from '../icon/Icon';
import s from './Breadcrumb.module.css';

export type Crumb = { label: string; href?: string };

/** Product Page «مسیر»: muted links separated by chevron_left; the last item is the current page. */
export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="مسیر" className={s.nav}>
      <ol className={s.list}>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              <li className={last ? s.current : s.item}>
                {last || !c.href ? (
                  <span aria-current={last ? 'page' : undefined}>{c.label}</span>
                ) : (
                  <Link href={c.href} className={s.link}>
                    {c.label}
                  </Link>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className={s.sep}>
                  <Icon name="chevron_left" size={16} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
