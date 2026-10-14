import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';

export type OtpPurpose = 'login' | 'register';

export const otpRepository = {
  /**
   * Serialises OTP work per phone for the rest of the transaction, so two parallel requests cannot both pass
   * the rate-limit check (transaction-scoped advisory lock, released on COMMIT/ROLLBACK).
   */
  async lockPhone(db: Queryable, phone: string): Promise<void> {
    await query('otp.lock_phone', `SELECT pg_advisory_xact_lock(hashtext('otp:' || $1))`, [phone], db);
  },

  /** Codes sent to a phone: how many in the window and when the last one was (index phone, created_at DESC). */
  async recentForPhone(db: Queryable, phone: string, windowSeconds: number) {
    const row = await queryOne<{ count: number; last_at: Date | null }>(
      'otp.recent_for_phone',
      `SELECT count(*)::int AS count, max(created_at) AS last_at
         FROM otp_codes
        WHERE phone = $1 AND created_at > now() - make_interval(secs => $2)`,
      [phone, windowSeconds],
      db,
    );
    return { count: row?.count ?? 0, lastAt: row?.last_at ?? null };
  },

  async countForIp(db: Queryable, ip: string, windowSeconds: number): Promise<number> {
    const row = await queryOne<{ count: number }>(
      'otp.count_for_ip',
      `SELECT count(*)::int AS count
         FROM otp_codes
        WHERE request_ip = $1 AND created_at > now() - make_interval(secs => $2)`,
      [ip, windowSeconds],
      db,
    );
    return row?.count ?? 0;
  },

  /** Wrong guesses for a phone in the window (a successful verify also counts one attempt, so it is excluded). */
  async failedAttempts(phone: string, windowSeconds: number, db?: Queryable): Promise<number> {
    const row = await queryOne<{ failed: number }>(
      'otp.failed_attempts',
      `SELECT COALESCE(sum(attempts - CASE WHEN consumed_at IS NULL THEN 0 ELSE 1 END), 0)::int AS failed
         FROM otp_codes
        WHERE phone = $1 AND created_at > now() - make_interval(secs => $2)`,
      [phone, windowSeconds],
      db,
    );
    return row?.failed ?? 0;
  },

  async insert(
    db: Queryable,
    v: { phone: string; codeHash: string; purpose: OtpPurpose; ttlSeconds: number; ip: string | null },
  ): Promise<void> {
    await query(
      'otp.insert',
      `INSERT INTO otp_codes (phone, code_hash, purpose, expires_at, request_ip)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)`,
      [v.phone, v.codeHash, v.purpose, v.ttlSeconds, v.ip],
      db,
    );
  },

  /**
   * Spends one attempt on the phone's newest code, atomically. Returns the code only if it is still usable
   * (not consumed, not expired, attempts left) — the caller then compares hashes. Older codes never count.
   */
  async spendAttempt(phone: string, maxAttempts: number) {
    return queryOne<{ id: string; code_hash: string; purpose: OtpPurpose }>(
      'otp.spend_attempt',
      `UPDATE otp_codes SET attempts = attempts + 1
        WHERE id = (SELECT id FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC, id DESC LIMIT 1)
          AND consumed_at IS NULL AND expires_at > now() AND attempts < $2
        RETURNING id::text, code_hash, purpose`,
      [phone, maxAttempts],
    );
  },

  /** Single use: true only for the first caller (a replayed code loses the race). */
  async consume(db: Queryable, id: string): Promise<boolean> {
    const row = await queryOne(
      'otp.consume',
      `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`,
      [id],
      db,
    );
    return row !== null;
  },
};
