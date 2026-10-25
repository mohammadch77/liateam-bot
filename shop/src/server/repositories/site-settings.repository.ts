import 'server-only';
import { query, type Queryable } from '@/lib/db';

/**
 * The shop's own switches (site_settings: key → JSON value). The app role never deletes: a setting is overwritten.
 * Keys of the settings page: 'pricing.discount_mode', 'seo.block_indexing'.
 */
export const siteSettingsRepository = {
  async get(keys: readonly string[]): Promise<Map<string, unknown>> {
    const rows = await query<{ key: string; value: unknown }>(
      'site_settings.get',
      'SELECT key, value FROM site_settings WHERE key = ANY($1::text[])',
      [keys],
    );
    return new Map(rows.map((r) => [r.key, r.value]));
  },

  /** `by` = the admin's user id, null for the system (e.g. the last revalidate time) */
  async set(key: string, value: unknown, by: string | null, db?: Queryable): Promise<void> {
    await query(
      'site_settings.set',
      `INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), by],
      db,
    );
  },
};
