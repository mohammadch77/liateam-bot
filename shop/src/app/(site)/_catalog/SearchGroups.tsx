import Image from 'next/image';
import Link from 'next/link';
import { formatNumber } from '@/lib/format/number';
import type { SearchGroupItem } from '@/server/services/catalog.service';
import { Icon } from '@/ui';
import s from './search-groups.module.css';

/**
 * The categories and brands a search matched, as picture cards (a picture or an icon, the name, how many products): the results page
 * shows them above the products, and the empty search offers the main categories the same way. Two columns on a phone.
 */
export function SearchGroups({
  title,
  items,
  kind,
  chips,
}: {
  title: string;
  items: readonly SearchGroupItem[];
  kind: 'category' | 'brand';
  /** small chips (the matched categories and brands above the products) instead of picture cards */
  chips?: boolean;
}) {
  if (!items.length) return null;
  if (chips)
    return (
      <ul className={s.chips} aria-label={title} data-search-group={kind}>
        {items.map((g) => (
          <li key={g.href}>
            <Link href={g.href} className={s.chip} data-search-card={kind}>
              <Icon name={kind === 'category' ? 'category' : 'verified'} size={16} />
              {g.name}
              <span className={s.chipCount}>{formatNumber(g.count)}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  return (
    <section className={s.group} aria-label={title} data-search-group={kind}>
      <h2 className={s.title}>{title}</h2>
      <ul className={s.grid}>
        {items.map((g) => (
          <li key={g.href}>
            <Link href={g.href} className={s.card} data-search-card={kind}>
              <span className={s.photo}>
                {g.imageUrl ? (
                  <Image src={g.imageUrl} alt="" fill sizes="(min-width: 1024px) 120px, 40vw" draggable={false} className={s.img} />
                ) : (
                  <Icon name={kind === 'category' ? 'category' : 'verified'} size={32} />
                )}
              </span>
              <span className={s.name}>{g.name}</span>
              <span className={s.count}>
                {formatNumber(g.count)} محصول{g.parent ? ` · در ${g.parent}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
