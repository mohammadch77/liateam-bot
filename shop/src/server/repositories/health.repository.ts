import 'server-only';
import { queryOne } from '@/lib/db';

export const healthRepository = {
  /** Round-trip to Postgres; throws AppError when the database is unreachable. */
  async ping(): Promise<void> {
    await queryOne<{ ok: number }>('health.ping', 'SELECT 1 AS ok');
  },
};
