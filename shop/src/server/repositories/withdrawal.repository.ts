import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import type { WithdrawalStatus } from '@/lib/wallet/withdraw';

/**
 * Withdrawals (migration 023). The amount is held in the wallet ledger when the request is made; a rejected or cancelled one
 * returns it. The account number (iban) lives only in this table: customer-facing reads below never select it, the admin
 * reads (`listWithIban`, `lock`) are only called from services that check the role. The row's user, amount and account never change.
 */
export type WithdrawalRow = {
  id: string;
  user_id: string;
  amount: number;
  holder_name: string;
  status: WithdrawalStatus;
  hold_ledger_id: string | null;
  return_ledger_id: string | null;
  paid_ref: string | null;
  reject_reason: string | null;
  decided_by: string | null;
  created_at: Date;
  decided_at: Date | null;
  /** only the last four digits (computed in SQL, so the whole number never reaches a customer's page) */
  iban_last4: string;
};
export type WithdrawalWithIban = WithdrawalRow & { iban: string };

const COLS = `id::text, user_id::text, amount::float8, holder_name, status, hold_ledger_id::text, return_ledger_id::text,
  paid_ref, reject_reason, decided_by::text, created_at, decided_at, right(iban, 4) AS iban_last4`;
const WCOLS = `w.id::text, w.user_id::text, w.amount::float8, w.holder_name, w.status, w.hold_ledger_id::text, w.return_ledger_id::text,
  w.paid_ref, w.reject_reason, w.decided_by::text, w.created_at, w.decided_at, right(w.iban, 4) AS iban_last4`;

export const withdrawalRepository = {
  async create(
    w: { userId: string; amount: number; iban: string; holderName: string },
    db: Queryable,
  ): Promise<WithdrawalRow> {
    const rows = await query<WithdrawalRow>(
      'withdrawal.create',
      `INSERT INTO withdrawals (user_id, amount, iban, holder_name) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
      [w.userId, w.amount, w.iban, w.holderName],
      db,
    );
    return rows[0]!;
  },

  /** Links the hold row of the ledger (once; the database refuses a change). */
  async setHold(id: string, ledgerId: string, db: Queryable): Promise<void> {
    await query(
      'withdrawal.set_hold',
      'UPDATE withdrawals SET hold_ledger_id = $2 WHERE id = $1',
      [id, ledgerId],
      db,
    );
  },

  async hasPending(userId: string, db?: Queryable): Promise<boolean> {
    const r = await queryOne<{ ok: boolean }>(
      'withdrawal.has_pending',
      "SELECT true AS ok FROM withdrawals WHERE user_id = $1 AND status = 'pending' LIMIT 1",
      [userId],
      db,
    );
    return r?.ok === true;
  },

  /** Total of the user's pending and paid withdrawals (rejected and cancelled ones were returned to the wallet). */
  async sumActive(userId: string, db?: Queryable): Promise<number> {
    const r = await queryOne<{ s: number }>(
      'withdrawal.sum_active',
      "SELECT coalesce(sum(amount), 0)::float8 AS s FROM withdrawals WHERE user_id = $1 AND status IN ('pending', 'paid')",
      [userId],
      db,
    );
    return r?.s ?? 0;
  },

  async sumPending(userId: string, db?: Queryable): Promise<number> {
    const r = await queryOne<{ s: number }>(
      'withdrawal.sum_pending',
      "SELECT coalesce(sum(amount), 0)::float8 AS s FROM withdrawals WHERE user_id = $1 AND status = 'pending'",
      [userId],
      db,
    );
    return r?.s ?? 0;
  },

  async listForUser(userId: string, limit: number, db?: Queryable): Promise<WithdrawalRow[]> {
    return query<WithdrawalRow>(
      'withdrawal.list_user',
      `SELECT ${COLS} FROM withdrawals WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
      [userId, limit],
      db,
    );
  },

  /** The row, locked for the transaction; only the owner's when `userId` is given (another user's id is not found). */
  async lock(id: string, userId: string | null, db: Queryable): Promise<WithdrawalWithIban | null> {
    return queryOne<WithdrawalWithIban>(
      'withdrawal.lock',
      `SELECT ${COLS}, iban FROM withdrawals WHERE id = $1 AND ($2::bigint IS NULL OR user_id = $2::bigint) FOR UPDATE`,
      [id, userId],
      db,
    );
  },

  /** pending → paid / rejected / canceled (false when it is no longer pending). */
  async decide(
    id: string,
    to: Exclude<WithdrawalStatus, 'pending'>,
    d: { decidedBy: string | null; paidRef?: string | null; reason?: string | null; returnLedgerId?: string | null },
    db: Queryable,
  ): Promise<boolean> {
    const rows = await query<{ id: string }>(
      'withdrawal.decide',
      `UPDATE withdrawals SET status = $2::withdrawal_status, decided_at = now(), decided_by = $3, paid_ref = $4,
              reject_reason = $5, return_ledger_id = $6
        WHERE id = $1 AND status = 'pending' RETURNING id::text`,
      [id, to, d.decidedBy, d.paidRef ?? null, d.reason ?? null, d.returnLedgerId ?? null],
      db,
    );
    return rows.length === 1;
  },

  /** Admin list with the full account number (only from a service that checks the admin role). */
  async listWithIban(status: WithdrawalStatus | null, limit: number, offset: number, db?: Queryable) {
    return query<WithdrawalWithIban & { phone: string }>(
      'withdrawal.list_admin',
      `SELECT ${WCOLS}, w.iban, u.phone
         FROM withdrawals w JOIN users u ON u.id = w.user_id
        WHERE ($1::text IS NULL OR w.status::text = $1::text) ORDER BY w.id DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset],
      db,
    );
  },

  async counts(db?: Queryable): Promise<Record<WithdrawalStatus, number>> {
    const rows = await query<{ status: WithdrawalStatus; n: number }>(
      'withdrawal.counts',
      'SELECT status, count(*)::int AS n FROM withdrawals GROUP BY status',
      [],
      db,
    );
    const out: Record<WithdrawalStatus, number> = { pending: 0, paid: 0, rejected: 0, canceled: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  },

  async pendingCount(db?: Queryable): Promise<number> {
    const r = await queryOne<{ n: number }>(
      'withdrawal.pending_count',
      "SELECT count(*)::int AS n FROM withdrawals WHERE status = 'pending'",
      [],
      db,
    );
    return r?.n ?? 0;
  },
};
