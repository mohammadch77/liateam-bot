// Price sanity checks. Prices are TOMAN (see SOURCE_PRICE_UNIT in normalize.mjs).
// Three layers, because each catches what the others cannot:
//   1. per product, against the last accepted values: a jump beyond priceJumpLimit (50%) is not written;
//   2. per product, absolute: outside the plausible toman range, or a cost/price ratio that no real product has —
//      this also protects NEW products, which have no previous value to compare with;
//   3. per run (checkUnitDrift): when most of the catalog moves by ~×10 or ~÷10 at once, the unit changed —
//      the whole run stops before anything is written.
import { config } from './config.mjs';

/** Errors that stop the run before writing (sync.mjs classifies them as 'unit'). */
export class UnitError extends Error {}

const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * Returns a list of problems; empty = safe to write.
 * `prev` is the last stored row (or undefined for a new product).
 */
export function checkProduct(next, prev) {
  const problems = [];
  const { min, max } = config.priceRangeToman;
  for (const field of ['price', 'cost_price']) {
    const v = next[field];
    if (v == null || v <= 0) {
      problems.push(`${field} is empty/zero (${v})`);
      continue;
    }
    if (v < min || v > max) {
      problems.push(`${field} ${fmt(v)} toman is outside the plausible range ${fmt(min)}–${fmt(max)} (unit change?)`);
    }
    const old = prev?.[field] == null ? null : Number(prev[field]);
    if (old > 0) {
      const change = Math.abs(v - old) / old;
      if (change > config.priceJumpLimit) {
        problems.push(`${field} jumped ${(change * 100).toFixed(0)}% (${old} -> ${v})`);
      }
    }
  }
  // Liateam's partner price sits a few percent under the consumer price (≈0.96). A ratio near 10 or 0.1 means
  // one of the two fields switched unit; a cost above the price would also mean selling at a loss.
  if (next.price > 0 && next.cost_price > 0) {
    const ratio = next.cost_price / next.price;
    if (ratio > config.costRatio.max || ratio < config.costRatio.min) {
      problems.push(`cost/price ratio ${ratio.toFixed(2)} outside ${config.costRatio.min}–${config.costRatio.max} (${fmt(next.cost_price)} / ${fmt(next.price)})`);
    }
  }
  if (next.stock == null || next.stock < 0) problems.push(`stock invalid (${next.stock})`);
  return problems;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

/**
 * Whole-catalog unit check: median of new/previous price over products present in both runs. Normal days sit at
 * 1.0 (a price rise moves a few products, never the median); a unit switch moves everything by ~10×.
 * Throws UnitError (nothing is written). Needs at least 20 comparable products to judge.
 */
export function checkUnitDrift(products, prev) {
  const ratios = [];
  for (const p of products) {
    const old = Number(prev.get(p.id)?.price);
    if (old > 0 && p.price > 0) ratios.push(p.price / old);
  }
  if (ratios.length < 20) return null;
  const m = median(ratios);
  if (m >= 5 || m <= 0.2) {
    throw new UnitError(
      `میانه‌ی نسبت قیمت جدید به قبلی ${m.toFixed(2)} است (روی ${ratios.length} محصول): واحد قیمت لیاتیم احتمالاً ` +
        `عوض شده (تومان ↔ ریال). هیچ قیمتی نوشته نشد.`,
    );
  }
  return m;
}
