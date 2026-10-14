import Link from 'next/link';
import type { ElementType, ReactNode } from 'react';
import { Icon } from '../icon/Icon';
import { cx } from '../cx';
import s from './Layout.module.css';

/** Centered content column with the responsive page gutter. */
export function Container({
  children,
  as: Tag = 'div',
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={cx(s.container, className)}>{children}</Tag>;
}

type SectionProps = {
  title: ReactNode;
  /** «مشاهده همه» link on the left of the heading */
  action?: { href: string; label: string };
  children: ReactNode;
  id?: string;
};

/** Page section with the Avina heading (rose-gold underline). */
export function Section({ title, action, children, id }: SectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={s.section} aria-labelledby={headingId} id={id}>
      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle} id={headingId}>
          {title}
        </h2>
        {action && (
          <Link href={action.href} className={s.sectionAction}>
            {action.label}
            <Icon name="arrow_back" size={18} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Responsive product grid: 2 / 3 / 4 / 5 columns; `withSidebar` drops one column next to side filters. */
export function ProductGrid({ children, withSidebar }: { children: ReactNode; withSidebar?: boolean }) {
  return <div className={cx(s.grid, withSidebar && s.withSidebar)}>{children}</div>;
}
