import 'server-only';
import pg from 'pg';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

// BIGINT (TOMAN amounts) and NUMERIC as JS numbers; amounts stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

/**
 * One pool per process. Kept on globalThis so dev hot-reload does not open a new pool on every edit.
 * Small on purpose: the shop shares this Postgres with the sync bot and the dashboard.
 */
const g = globalThis as typeof globalThis & { __shopPool?: pg.Pool };

function createPool(): pg.Pool {
  const c = getConfig();
  const pool = new pg.Pool({
    connectionString: c.DATABASE_URL,
    max: c.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: c.DB_STATEMENT_TIMEOUT_MS,
    application_name: `liateam-shop-${c.APP_ENV}`,
    // Shop tables live in their own schema; supplier tables (product_catalog, categories) stay in public.
    options: `-c search_path=${c.DB_SCHEMA},public`,
  });
  // An idle client losing its connection must not crash the process; the pool replaces it.
  pool.on('error', (err) => logger.error('db.pool.idle_client_error', { err }));
  return pool;
}

export function getPool(): pg.Pool {
  g.__shopPool ??= createPool();
  return g.__shopPool;
}
