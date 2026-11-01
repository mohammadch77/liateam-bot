import 'server-only';
import { query, queryOne, type Queryable } from '@/lib/db';
import type { Sealed } from '@/lib/crypto/secret-box';

/**
 * secret_settings (migration 018): sealed secrets. This repository never sees a plaintext; the list has no ciphertext at
 * all. The app role cannot delete, so a secret is replaced (upsert), never removed.
 */
export type SecretMeta = { key: string; hint: string; updatedAt: Date; updatedBy: string | null };

export const secretSettingsRepository = {
  /** which secrets exist, with their masked-display hint — no ciphertext */
  async list(keys: readonly string[]): Promise<SecretMeta[]> {
    const rows = await query<{ key: string; hint: string; updated_at: Date; updated_by: string | null }>(
      'secret_settings.list',
      `SELECT key, hint, updated_at, updated_by::text FROM secret_settings WHERE key = ANY($1::text[])`,
      [keys],
    );
    return rows.map((r) => ({ key: r.key, hint: r.hint, updatedAt: r.updated_at, updatedBy: r.updated_by }));
  },

  async sealed(key: string): Promise<Sealed | null> {
    const r = await queryOne<{ ciphertext: Buffer; nonce: Buffer; key_version: number }>(
      'secret_settings.sealed',
      `SELECT ciphertext, nonce, key_version FROM secret_settings WHERE key = $1`,
      [key],
    );
    return r ? { ciphertext: r.ciphertext, nonce: r.nonce, keyVersion: r.key_version } : null;
  },

  async upsert(db: Queryable, key: string, s: Sealed, hint: string, by: string): Promise<void> {
    await query(
      'secret_settings.upsert',
      `INSERT INTO secret_settings (key, ciphertext, nonce, key_version, hint, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (key) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
         key_version = EXCLUDED.key_version, hint = EXCLUDED.hint, updated_by = EXCLUDED.updated_by`,
      [key, s.ciphertext, s.nonce, s.keyVersion, hint, by],
      db,
    );
  },
};
