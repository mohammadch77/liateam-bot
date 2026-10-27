import type { FreeShipping } from '../shipping';

/**
 * Settings of the order flow (site_settings, key → JSON). Migration 016 stores the starting values; parse() turns
 * whatever is stored into a safe value (a missing or malformed one falls back to the default, never throws).
 */
export const ORDER_SETTING_KEYS = {
  priceTolerance: 'orders.price_tolerance_toman',
  autoPlaceEnabled: 'orders.auto_place_enabled',
  autoPlaceHours: 'orders.auto_place_hours',
  freeShippingEnabled: 'shipping.free_enabled',
  freeShippingFrom: 'shipping.free_from_toman',
} as const;

export type AutoPlaceHours = { from: string; to: string }; // 'HH:MM' Asia/Tehran

export type OrderSettings = {
  /** a live Liateam total that moved more than this many toman stops an order (needs_review) */
  priceToleranceToman: number;
  /** master switch of automatic placing at Liateam */
  autoPlaceEnabled: boolean;
  autoPlaceHours: AutoPlaceHours;
  freeShipping: FreeShipping;
};

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  priceToleranceToman: 10,
  autoPlaceEnabled: false,
  autoPlaceHours: { from: '09:00', to: '21:00' },
  freeShipping: { enabled: false, fromToman: 999_000 },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseOrderSettings(raw: ReadonlyMap<string, unknown>): OrderSettings {
  const d = DEFAULT_ORDER_SETTINGS;
  const k = ORDER_SETTING_KEYS;
  const num = (v: unknown, min: number, fallback: number) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : fallback;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const hours = raw.get(k.autoPlaceHours) as Partial<AutoPlaceHours> | undefined;
  return {
    priceToleranceToman: num(raw.get(k.priceTolerance), 0, d.priceToleranceToman),
    autoPlaceEnabled: bool(raw.get(k.autoPlaceEnabled), d.autoPlaceEnabled),
    autoPlaceHours:
      typeof hours?.from === 'string' &&
      typeof hours.to === 'string' &&
      HHMM.test(hours.from) &&
      HHMM.test(hours.to)
        ? { from: hours.from, to: hours.to }
        : d.autoPlaceHours,
    freeShipping: {
      enabled: bool(raw.get(k.freeShippingEnabled), d.freeShipping.enabled),
      fromToman: num(raw.get(k.freeShippingFrom), 1, d.freeShipping.fromToman),
    },
  };
}

/** Is `now` inside the working hours (Tehran wall clock `hhmm` = minutes since midnight)? from > to wraps past midnight. */
export function insideAutoPlaceHours(hours: AutoPlaceHours, minutesSinceMidnight: number): boolean {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const from = m(hours.from);
  const to = m(hours.to);
  if (from === to) return true; // 24 hours
  return from < to
    ? minutesSinceMidnight >= from && minutesSinceMidnight < to
    : minutesSinceMidnight >= from || minutesSinceMidnight < to;
}
