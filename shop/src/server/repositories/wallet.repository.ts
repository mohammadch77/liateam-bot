import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import { AppError } from '@/lib/errors';

/**
 * The shop's wallet: one append-only ledger (migration 014). The balance is balance_after of the latest row, computed
 * by the database under a per-user lock; a negative balance is refused (AppError INVALID_DATA), and an idempotency key
 * makes the same event inserted once. Amounts are signed TOMAN: topup / refund / commission positive, order_payment /
 * withdrawal negative.
 */
export type WalletEntryKind = 'topup' | 'order_payment' | 'refund' | 'withdrawal' | 'commission';

export type WalletEntryRow = {
  id: string;
  user_id: string;
  kind: WalletEntryKind;
  amount: number;
  balance_after: number;
  idempotency_key: string;
  order_id: string | null;
  ref: string | null;
  note: string | null;
  created_at: Date;
};

export type NewWalletEntry = {
  userId: string;
  kind: WalletEntryKind;
  amount: number;
  idempotencyKey: string;
  orderId?: string | null;
  ref?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

const COLS =
  'id::text, user_id::text, kind, amount::float8, balance_after::float8, idempotency_key, order_id::text, ref, note, created_at';

export const walletRepository = {
  async balance(userId: string, db?: Queryable): Promise<number> {
    const row = await queryOne<{ balance: number }>(
      'wallet.balance',
      'SELECT balance_after::float8 AS balance FROM wallet_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [userId],
      db,
    );
    return row?.balance ?? 0;
  },

  /**
   * Adds a ledger row. `duplicate` is true when the idempotency key was already used (the earlier row is returned and
   * nothing changes). Throws AppError('INVALID_DATA') when the balance would go negative or the sign does not fit the kind.
   */
  async post(e: NewWalletEntry, db?: Queryable): Promise<{ entry: WalletEntryRow; duplicate: boolean }> {
    const rows = await query<WalletEntryRow>(
      'wallet.post',
      `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, order_id, ref, note, created_by)
       VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING ${COLS}`,
      [
        e.userId,
        e.kind,
        e.amount,
        e.idempotencyKey,
        e.orderId ?? null,
        e.ref ?? null,
        e.note?.slice(0, 200) ?? null,
        e.createdBy ?? null,
      ],
      db,
    );
    if (rows[0]) return { entry: rows[0], duplicate: false };
    const existing = await queryOne<WalletEntryRow>(
      'wallet.find_key',
      `SELECT ${COLS} FROM wallet_ledger WHERE idempotency_key = $1`,
      [e.idempotencyKey],
      db,
    );
    if (!existing) throw new AppError('INTERNAL');
    return { entry: existing, duplicate: true };
  },

  async entries(userId: string, limit = 50, db?: Queryable): Promise<WalletEntryRow[]> {
    return query<WalletEntryRow>(
      'wallet.entries',
      `SELECT ${COLS} FROM wallet_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
      [userId, limit],
      db,
    );
  },
};
