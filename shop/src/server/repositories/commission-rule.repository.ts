import 'server-only';
import { query, type Queryable } from '@/lib/db';
import type { CommissionRule } from '@/lib/commission/engine';
import type { RuleInput } from '@/lib/commission/validate';

/**
 * commission_rules (migrations 015 + 019): the rules the client enters. Created EMPTY: no default rule exists. The app role
 * never deletes; a rule is switched off with `active`.
 */
type Row = {
  id: string;
  name: string;
  scope_type: 'all' | 'category' | 'brand' | 'product';
  scope_id: string | null;
  level: number;
  kind: 'percent' | 'fixed';
  value: string;
  min_order_total: string;
  max_per_order: string | null;
  hold_days: number;
  manual_approval: boolean;
  active: boolean;
  valid_from: Date | null;
  valid_to: Date | null;
};

const COLS = `id::text, name, scope_type, scope_id::text, level, kind, value::text, min_order_total::text,
  max_per_order::text, hold_days, manual_approval, active, valid_from, valid_to`;

const toRule = (r: Row): CommissionRule => ({
  id: Number(r.id),
  name: r.name,
  scope: r.scope_type === 'all' ? { type: 'all' } : { type: r.scope_type, id: Number(r.scope_id) },
  level: r.level,
  kind: r.kind,
  value: Number(r.value),
  minOrderTotal: Number(r.min_order_total),
  maxPerOrder: r.max_per_order === null ? null : Number(r.max_per_order),
  holdDays: r.hold_days,
  manualApproval: r.manual_approval,
  active: r.active,
  validFrom: r.valid_from,
  validTo: r.valid_to,
});

const args = (v: RuleInput) => [
  v.name,
  v.scope.type,
  v.scope.type === 'all' ? null : v.scope.id,
  v.level,
  v.kind,
  v.value,
  v.minOrderTotal,
  v.maxPerOrder,
  v.holdDays,
  v.active,
  v.validFrom,
  v.validTo,
  v.manualApproval === true,
];

export const commissionRuleRepository = {
  async list(db?: Queryable): Promise<CommissionRule[]> {
    const rows = await query<Row>(
      'commission_rule.list',
      `SELECT ${COLS} FROM commission_rules ORDER BY level, active DESC, id`,
      [],
      db,
    );
    return rows.map(toRule);
  },

  /** Ids of the rules whose commissions wait for an admin's approval. */
  async manualIds(db?: Queryable): Promise<Set<number>> {
    const rows = await query<{ id: string }>(
      'commission_rule.manual_ids',
      'SELECT id::text FROM commission_rules WHERE manual_approval',
      [],
      db,
    );
    return new Set(rows.map((r) => Number(r.id)));
  },

  async get(id: number, db?: Queryable): Promise<CommissionRule | null> {
    const rows = await query<Row>(
      'commission_rule.get',
      `SELECT ${COLS} FROM commission_rules WHERE id = $1`,
      [id],
      db,
    );
    return rows[0] ? toRule(rows[0]) : null;
  },

  async insert(db: Queryable, v: RuleInput, by: string): Promise<number> {
    const rows = await query<{ id: string }>(
      'commission_rule.insert',
      `INSERT INTO commission_rules (name, scope_type, scope_id, level, kind, value, min_order_total, max_per_order,
                                     hold_days, active, valid_from, valid_to, manual_approval, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text`,
      [...args(v), by],
      db,
    );
    return Number(rows[0]!.id);
  },

  async update(db: Queryable, id: number, v: RuleInput): Promise<boolean> {
    const rows = await query(
      'commission_rule.update',
      `UPDATE commission_rules SET name=$1, scope_type=$2, scope_id=$3, level=$4, kind=$5, value=$6, min_order_total=$7,
              max_per_order=$8, hold_days=$9, active=$10, valid_from=$11, valid_to=$12, manual_approval=$13
        WHERE id = $14 RETURNING id`,
      [...args(v), id],
      db,
    );
    return rows.length === 1;
  },
};
