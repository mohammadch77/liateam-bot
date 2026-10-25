import type { ListParams } from '@/server/services/catalog.service';

/**
 * Builds listing URLs that keep the current filters. Defaults are left out so URLs stay short and canonical
 * (page 1 and the default sort never appear).
 */
export function listingHref(base: string, params: ListParams, change: Partial<ListParams> = {}): string {
  const next = { ...params, ...change };
  const sp = new URLSearchParams();
  if (next.q) sp.set('q', next.q);
  if (next.cat) sp.set('cat', String(next.cat));
  if (next.group && !next.cat) sp.set('group', next.group);
  if (next.inStock === '1') sp.set('inStock', '1');
  if (next.min !== undefined) sp.set('min', String(next.min));
  if (next.max !== undefined) sp.set('max', String(next.max));
  if (next.sort && next.sort !== 'relevance') sp.set('sort', next.sort);
  if (next.page && next.page > 1) sp.set('page', String(next.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
