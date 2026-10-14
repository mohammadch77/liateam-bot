import 'server-only';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

/** Node-only startup checks; a missing or invalid variable prints a readable list and exits with code 1. */
export function runStartupChecks(): void {
  try {
    const c = getConfig();
    logger.info('shop.start', { env: c.APP_ENV, port: c.PORT, schema: c.DB_SCHEMA, poolMax: c.DB_POOL_MAX });
  } catch (e) {
    process.stderr.write(`\n[liateam-shop] ${e instanceof Error ? e.message : String(e)}\n\n`);
    process.exit(1);
  }
}
