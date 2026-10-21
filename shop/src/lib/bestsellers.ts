/**
 * «پرفروش‌ترین‌ها» (pure; no database): the home tabs, which Liateam categories each covers — the one place to edit
 * them — and how a tab's list is built.
 *
 * Category codes are Liateam's (their tree, 2026-10); a code means itself and its whole subtree.
 */

export type BestsellerTabKey = 'all' | 'skin' | 'makeup' | 'scent' | 'hair';

export const BESTSELLER_TABS: ReadonlyArray<{
  key: BestsellerTabKey;
  label: string;
  /** null = every category */
  categories: readonly number[] | null;
}> = [
  { key: 'all', label: 'همه', categories: null },
  {
    key: 'skin',
    label: 'مراقبت پوست',
    // face serum, eye area, face kits, face cream, sunscreen, face mask, face cleansers (gel, toner, micellar,
    // bi-phase, foam)
    categories: [155, 158, 161, 165, 170, 180, 191, 192, 193, 194, 195],
  },
  { key: 'makeup', label: 'آرایشی', categories: [173] },
  {
    key: 'scent',
    label: 'عطر و بدن',
    // perfume & body mist & roll-on, body serum, body kits, body cream, body oil, lotion, body shampoo, soap, pan,
    // hand wash
    categories: [150, 157, 162, 166, 169, 200, 177, 196, 197, 198],
  },
  {
    key: 'hair',
    label: 'مو و دهان',
    // hair serum, hair kits, hair oil, shampoo, hair mask, mouth & teeth
    categories: [156, 160, 168, 176, 179, 186],
  },
];

export const BESTSELLER_LIMIT = 10;

export const isTabKey = (v: unknown): v is BestsellerTabKey => BESTSELLER_TABS.some((t) => t.key === v);

/** A product that may appear (already only visible, in stock, inside the tab's categories — or a manual pick). */
export type BestsellerCandidate = {
  id: number;
  bestSelling: boolean;
  popular: boolean;
  reviews: number;
  rating: number;
  firstSeen: Date;
};

export type BestsellerSource = 'manual' | 'liateam' | 'fill';

/**
 * The tab's list, at most `limit`, never twice the same product:
 *   1. the admin's picks in their order (those that are sellable and in stock now),
 *   2. products with Liateam's «best-selling» tag (when the tab uses it), most reviewed first,
 *   3. fill-up: Liateam's «popular» tag first, then the most reviews, then the best rating, then the newest.
 */
export function composeBestsellers(
  picks: readonly number[],
  candidates: readonly BestsellerCandidate[],
  opts: { useLiateamTag: boolean; limit?: number },
): Array<{ id: number; source: BestsellerSource }> {
  const limit = opts.limit ?? BESTSELLER_LIMIT;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: Array<{ id: number; source: BestsellerSource }> = [];
  const seen = new Set<number>();
  const take = (id: number, source: BestsellerSource) => {
    if (out.length >= limit || seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    out.push({ id, source });
  };
  for (const id of picks) take(id, 'manual');
  const popularity = (a: BestsellerCandidate, b: BestsellerCandidate) =>
    b.reviews - a.reviews ||
    b.rating - a.rating ||
    b.firstSeen.getTime() - a.firstSeen.getTime() ||
    a.id - b.id;
  if (opts.useLiateamTag)
    for (const c of candidates.filter((x) => x.bestSelling).sort(popularity)) take(c.id, 'liateam');
  for (const c of [...candidates].sort((a, b) => Number(b.popular) - Number(a.popular) || popularity(a, b)))
    take(c.id, 'fill');
  return out;
}

// ── header menus (part 4): products of a sub-category or a brand, in the same order as «پرفروش‌ترین‌ها» ──

/** Cards in a menu pane: 6 from 1280 px wide, 4 below (the pane never scrolls sideways). */
export const NAV_LIMITS = { wide: 6, narrow: 4, wideFrom: 1280 } as const;
export function navLimit(viewportWidth: number): number {
  return viewportWidth >= NAV_LIMITS.wideFrom ? NAV_LIMITS.wide : NAV_LIMITS.narrow;
}

/**
 * A menu pane's products: the same rule as a best-seller tab (picks → Liateam's best-selling tag → fill-up), at most
 * `limit`; `more` = there are more products than shown (then the pane shows «مشاهده همه»).
 */
export function composeNavProducts(
  picks: readonly number[],
  candidates: readonly BestsellerCandidate[],
  limit: number,
): { ids: number[]; more: boolean } {
  const list = composeBestsellers(picks, candidates, { useLiateamTag: true, limit });
  return { ids: list.map((x) => x.id), more: candidates.length > list.length };
}
