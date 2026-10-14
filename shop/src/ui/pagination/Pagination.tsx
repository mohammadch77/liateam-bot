import Link from 'next/link';
import { formatNumber } from '@/lib/format/number';
import { Icon } from '../icon/Icon';
import { cx } from '../cx';
import s from './Pagination.module.css';

type PaginationProps = {
  page: number;
  totalPages: number;
  /** builds the URL of a page (keeps the current filters); plain links, so it works without JavaScript */
  hrefFor: (page: number) => string;
};

/** Pages to show: first, last, current ±1, with gaps. 1 … 4 5 6 … 12 */
export function pageWindow(page: number, total: number): Array<number | 'gap'> {
  const keep = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) out.push(p - prev === 2 ? p - 1 : 'gap');
    out.push(p);
  });
  return out;
}

/**
 * Not in the Avina export: built from its tokens (44px touch targets, field radius, berry for the current page,
 * blush hover). Previous/next point right/left as RTL reading order requires.
 */
export function Pagination({ page, totalPages, hrefFor }: PaginationProps) {
  if (totalPages <= 1) return null;
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;
  return (
    <nav aria-label="صفحه‌بندی" className={s.nav}>
      <PageArrow href={prev ? hrefFor(prev) : null} label="صفحه قبل" icon="chevron_right" />
      <ol className={s.pages}>
        {pageWindow(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} className={s.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                href={hrefFor(p)}
                className={cx(s.page, p === page && s.current)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`صفحه ${formatNumber(p)}`}
              >
                {formatNumber(p)}
              </Link>
            </li>
          ),
        )}
      </ol>
      <PageArrow href={next ? hrefFor(next) : null} label="صفحه بعد" icon="chevron_left" />
    </nav>
  );
}

function PageArrow({
  href,
  label,
  icon,
}: {
  href: string | null;
  label: string;
  icon: 'chevron_left' | 'chevron_right';
}) {
  return href ? (
    <Link
      href={href}
      className={cx(s.page, s.arrow)}
      aria-label={label}
      rel={icon === 'chevron_left' ? 'next' : 'prev'}
    >
      <Icon name={icon} size={22} />
    </Link>
  ) : (
    <span className={cx(s.page, s.arrow, s.disabled)} aria-hidden="true">
      <Icon name={icon} size={22} />
    </span>
  );
}
