import 'server-only';

/**
 * The shop's in-memory caches (prices, packs, best sellers) register here; the bot's revalidate call
 * (POST /api/internal/revalidate) and admin changes drop them all, so the next request reads fresh data.
 */
const listeners = new Set<() => void>();

export function onDataChange(fn: () => void): void {
  listeners.add(fn);
}

export function dataChanged(): void {
  for (const fn of listeners) fn();
}
