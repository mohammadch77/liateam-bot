// Per-product price sanity check against the last accepted values.
import { config } from './config.mjs';

/**
 * Returns a list of problems; empty = safe to write.
 * `prev` is the last stored row (or undefined for a new product).
 */
export function checkProduct(next, prev) {
  const problems = [];
  for (const field of ['price', 'cost_price']) {
    const v = next[field];
    if (v == null || v <= 0) {
      problems.push(`${field} is empty/zero (${v})`);
      continue;
    }
    const old = prev?.[field] == null ? null : Number(prev[field]);
    if (old > 0) {
      const change = Math.abs(v - old) / old;
      if (change > config.priceJumpLimit) {
        problems.push(`${field} jumped ${(change * 100).toFixed(0)}% (${old} -> ${v})`);
      }
    }
  }
  if (next.stock == null || next.stock < 0) problems.push(`stock invalid (${next.stock})`);
  return problems;
}
