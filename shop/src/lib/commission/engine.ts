/**
 * The commission engine: a PURE function (no database, no clock except the `now` you pass). Given an order, the rules the
 * client entered and the buyer's referral chain, it says what each referrer earns. Recording real commissions is the next
 * step; the admin simulator and the tests use this same function.
 *
 * How it decides (written down because the client has not fixed the policy yet):
 *  - Levels: chain[0] is the buyer's referrer = level 1, chain[1] is that referrer's own referrer = level 2, and so on.
 *    A rule belongs to exactly one level; a level with no rule earns nothing. No referrer = no commission.
 *  - Base: the SELLING price of the goods (after discounts), shipping excluded, per order line.
 *  - Scope and priority: a line is matched by the MOST SPECIFIC applicable rule of that level:
 *    product > brand > category (a deeper category beats its parent) > all. Between equally specific rules the newer
 *    (higher id) wins. A rule that is inactive, outside its dates, or whose minimum order total is not reached is simply not
 *    applicable (the next most specific one is tried).
 *  - Percent rules take the percent of the matched lines' base. A FIXED rule pays its amount ONCE per order (when at least
 *    one line matched it), never per line.
 *  - Cap: a rule's `maxPerOrder` limits what that rule pays on this order.
 *  - Rounding: DOWN to a whole toman, once per rule (never up: the shop never pays a toman it did not earn).
 *  - Cancel / refund: the order earns nothing; every item comes back cancelled with amount 0.
 *  - Approval: an item is `pending` until the order is `sent` and the hold (the largest `holdDays` among the rules that
 *    paid it) has passed since it was sent; then `approved`.
 * Money is whole toman (safe integers); percent is applied with BigInt so a large order cannot lose precision.
 */
export type RuleScope =
  | { type: 'all' }
  | { type: 'category'; id: number }
  | { type: 'brand'; id: number }
  | { type: 'product'; id: number };

export type CommissionRule = {
  id: number;
  name: string;
  scope: RuleScope;
  /** 1..N */
  level: number;
  kind: 'percent' | 'fixed';
  /** percent 0 < v <= 100 (up to 4 decimals) or whole toman */
  value: number;
  minOrderTotal: number;
  maxPerOrder: number | null;
  holdDays: number;
  active: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
};

export type OrderLine = {
  productId: number;
  brandId: number | null;
  /** the product's category, then its ancestors: most specific first */
  categoryIds: readonly number[];
  /** toman: what the customer pays for this line, shipping excluded */
  lineTotal: number;
};

export type CommissionOrder = {
  lines: readonly OrderLine[];
  status: 'paid' | 'sent' | 'canceled' | 'refunded';
  createdAt: Date;
  /** when it was sent (status 'sent') */
  sentAt?: Date | null;
};

export type CommissionItem = {
  level: number;
  affiliateUserId: string;
  /** what the matched lines add up to */
  base: number;
  amount: number;
  ruleIds: number[];
  holdDays: number;
  status: 'pending' | 'approved' | 'cancelled';
  /** when a pending item becomes approvable (null until the order is sent) */
  approvableAt: Date | null;
};
export type CommissionSkip = {
  level: number;
  affiliateUserId: string;
  reason: 'no_rule' | 'no_matching_line' | 'zero_amount';
};
export type CommissionResult = { items: CommissionItem[]; skipped: CommissionSkip[]; goodsTotal: number };

const DAY = 86_400_000;

const SPECIFICITY = { product: 4_000_000, brand: 3_000_000, category: 2_000_000, all: 1_000_000 } as const;

function matchScore(rule: CommissionRule, line: OrderLine): number | null {
  const s = rule.scope;
  switch (s.type) {
    case 'all':
      return SPECIFICITY.all;
    case 'product':
      return line.productId === s.id ? SPECIFICITY.product : null;
    case 'brand':
      return line.brandId !== null && line.brandId === s.id ? SPECIFICITY.brand : null;
    case 'category': {
      const depth = line.categoryIds.indexOf(s.id);
      return depth === -1 ? null : SPECIFICITY.category - depth; // the line's own category beats its ancestors
    }
  }
}

function applicable(rule: CommissionRule, goodsTotal: number, at: Date): boolean {
  if (!rule.active) return false;
  if (rule.minOrderTotal > goodsTotal) return false;
  if (rule.validFrom && at < rule.validFrom) return false;
  if (rule.validTo && at >= rule.validTo) return false;
  return true;
}

/** floor(base * percent / 100) with percent given to 4 decimals, exactly */
export function percentOf(base: number, percent: number): number {
  const scaled = BigInt(Math.round(percent * 10_000));
  return Number((BigInt(base) * scaled) / 1_000_000n);
}

const positive = (n: number) => Number.isSafeInteger(n) && n > 0;

export function calculateCommissions(
  order: CommissionOrder,
  rules: readonly CommissionRule[],
  referralChain: readonly string[],
  now: Date = new Date(),
): CommissionResult {
  const goodsTotal = order.lines.reduce((a, l) => a + (positive(l.lineTotal) ? l.lineTotal : 0), 0);
  const dead = order.status === 'canceled' || order.status === 'refunded';
  const items: CommissionItem[] = [];
  const skipped: CommissionSkip[] = [];

  referralChain.forEach((affiliateUserId, i) => {
    const level = i + 1;
    const levelRules = rules.filter((r) => r.level === level && applicable(r, goodsTotal, order.createdAt));
    if (!levelRules.length) {
      skipped.push({ level, affiliateUserId, reason: 'no_rule' });
      return;
    }
    // each line goes to its most specific rule
    const perRule = new Map<number, { rule: CommissionRule; base: number }>();
    for (const line of order.lines) {
      if (!positive(line.lineTotal)) continue;
      let best: { rule: CommissionRule; score: number } | null = null;
      for (const rule of levelRules) {
        const score = matchScore(rule, line);
        if (score === null) continue;
        if (!best || score > best.score || (score === best.score && rule.id > best.rule.id))
          best = { rule, score };
      }
      if (!best) continue;
      const slot = perRule.get(best.rule.id) ?? { rule: best.rule, base: 0 };
      slot.base += line.lineTotal;
      perRule.set(best.rule.id, slot);
    }
    if (!perRule.size) {
      skipped.push({ level, affiliateUserId, reason: 'no_matching_line' });
      return;
    }
    let base = 0;
    let amount = 0;
    let hold = 0;
    const ruleIds: number[] = [];
    for (const { rule, base: b } of perRule.values()) {
      let a = rule.kind === 'percent' ? percentOf(b, rule.value) : Math.floor(rule.value);
      if (rule.maxPerOrder !== null) a = Math.min(a, rule.maxPerOrder);
      if (a <= 0) continue;
      amount += a;
      base += b;
      hold = Math.max(hold, rule.holdDays);
      ruleIds.push(rule.id);
    }
    if (amount <= 0) {
      skipped.push({ level, affiliateUserId, reason: 'zero_amount' });
      return;
    }
    const sentAt = order.status === 'sent' ? (order.sentAt ?? null) : null;
    const approvableAt = sentAt ? new Date(sentAt.getTime() + hold * DAY) : null;
    items.push({
      level,
      affiliateUserId,
      base: dead ? 0 : base,
      amount: dead ? 0 : amount,
      ruleIds: ruleIds.sort((x, y) => x - y),
      holdDays: hold,
      status: dead ? 'cancelled' : approvableAt && approvableAt <= now ? 'approved' : 'pending',
      approvableAt: dead ? null : approvableAt,
    });
  });
  return { items, skipped, goodsTotal };
}
