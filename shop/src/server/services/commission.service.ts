import 'server-only';
import {
  calculateCommissions,
  type CommissionOrder,
  type CommissionResult,
  type CommissionRule,
} from '@/lib/commission/engine';
import { MAX_LEVEL, parseRuleForm, type RuleInput } from '@/lib/commission/validate';
import { AppError } from '@/lib/errors';
import { authorize } from '@/server/auth/guards';
import type { RequestMeta } from '@/server/http/request';
import { auditRepository } from '@/server/repositories/audit.repository';
import { commissionRuleRepository } from '@/server/repositories/commission-rule.repository';
import { withTransaction } from '@/server/repositories/transaction';

/**
 * Commission rules for the admin: list, create, edit (no delete: switch off), and the simulator that runs the SAME pure
 * engine on a sample cart. Nothing here records real commissions; that comes with the order flow.
 */
type Form = { get(n: string): unknown };

/** the simulator's sample: up to 5 lines (product / brand / category codes are optional) and a chain depth */
export type SimulatorInput = {
  lines: Array<{ productId: number; brandId: number | null; categoryIds: number[]; lineTotal: number }>;
  chainDepth: number;
  status: CommissionOrder['status'];
  holdPassedDays: number;
};

const num = (v: unknown): number | null => {
  const t = String(v ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٬,\s]/g, '');
  return /^\d{1,12}$/.test(t) ? Number(t) : null;
};

/** The simulator's form (GET query) -> input; unreadable lines are left out. */
export function parseSimulator(q: Form): SimulatorInput | null {
  const lines: SimulatorInput['lines'] = [];
  for (let i = 1; i <= 5; i++) {
    const total = num(q.get(`l${i}.total`));
    if (!total) continue;
    const cats = String(q.get(`l${i}.cat`) ?? '')
      .split(/[,،\s]+/)
      .map(num)
      .filter((n): n is number => n !== null && n > 0);
    lines.push({
      productId: num(q.get(`l${i}.product`)) ?? 0,
      brandId: num(q.get(`l${i}.brand`)),
      categoryIds: cats,
      lineTotal: total,
    });
  }
  if (!lines.length) return null;
  const depth = Math.min(Math.max(num(q.get('depth')) ?? 1, 0), MAX_LEVEL);
  const status = ['paid', 'sent', 'canceled', 'refunded'].includes(String(q.get('status')))
    ? (String(q.get('status')) as CommissionOrder['status'])
    : 'paid';
  return { lines, chainDepth: depth, status, holdPassedDays: Math.min(num(q.get('held')) ?? 0, 365) };
}

export const commissionService = {
  async rules(): Promise<CommissionRule[]> {
    await authorize('admin');
    return commissionRuleRepository.list();
  },

  async rule(id: number): Promise<CommissionRule | null> {
    await authorize('admin');
    return commissionRuleRepository.get(id);
  },

  /** create (id null) or edit; audited with the rule's numbers (no personal data) */
  async save(id: number | null, form: Form, meta: RequestMeta): Promise<number> {
    const admin = await authorize('admin');
    const parsed = parseRuleForm(form);
    if (!parsed.ok) throw new AppError('INVALID_DATA', { message: parsed.error });
    const v: RuleInput = parsed.value;
    return withTransaction(async (db) => {
      let ruleId: number;
      if (id === null) ruleId = await commissionRuleRepository.insert(db, v, admin.id);
      else {
        if (!(await commissionRuleRepository.update(db, id, v))) throw new AppError('NOT_FOUND');
        ruleId = id;
      }
      await auditRepository.record(
        {
          actorUserId: admin.id,
          action: id === null ? 'commission_rule.create' : 'commission_rule.update',
          entityType: 'commission_rule',
          entityId: String(ruleId),
          meta: {
            name: v.name,
            scope: v.scope,
            level: v.level,
            kind: v.kind,
            value: v.value,
            active: v.active,
          },
          ip: meta.ip,
        },
        db,
      );
      return ruleId;
    });
  },

  /** the engine on a sample cart with the saved rules, now; nothing is stored */
  async simulate(input: SimulatorInput): Promise<CommissionResult> {
    await authorize('admin');
    const rules = await commissionRuleRepository.list();
    const now = new Date();
    const sentAt = new Date(now.getTime() - input.holdPassedDays * 86_400_000);
    const order: CommissionOrder = {
      lines: input.lines,
      status: input.status,
      createdAt: now,
      sentAt: input.status === 'sent' ? sentAt : null,
    };
    const chain = Array.from({ length: input.chainDepth }, (_, i) => `سطح ${i + 1}`);
    return calculateCommissions(order, rules, chain, now);
  },
};
