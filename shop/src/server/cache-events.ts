import 'server-only';

/**
 * The shop's in-memory caches (prices, packs, best sellers, settings) register here; the bot's revalidate call
 * (POST /api/internal/revalidate) and admin changes drop them all, so the next request reads fresh data.
 *
 * The listener set lives on globalThis, not in this module: Next.js compiles route handlers, pages and server actions
 * into separate bundles, each with its own copy of every module's variables. A module-level Set let the revalidate
 * route clear only ITS copy of the caches while the pages kept serving theirs until the minute ran out.
 */
const KEY = Symbol.for('liateam.shop.cache-listeners');
const store = globalThis as unknown as Record<symbol, Set<() => void> | undefined>;
const listeners = (store[KEY] ??= new Set<() => void>());

export function onDataChange(fn: () => void): void {
  listeners.add(fn);
}

export function dataChanged(): void {
  for (const fn of listeners) fn();
}
