import 'server-only';
import type pg from 'pg';
import { logger } from '@/lib/logger';
import { mapDbError } from './errors';
import { getPool } from './pool';

export type Queryable = Pick<pg.PoolClient, 'query'>;
type Params = readonly unknown[];

/**
 * Runs one parameterised statement. Errors are logged (with a statement label, never the parameters)
 * and rethrown as AppError. Pass `db` to run inside a transaction from withTransaction().
 */
export async function query<T extends pg.QueryResultRow>(
  label: string,
  sql: string,
  params: Params = [],
  db: Queryable = getPool(),
): Promise<T[]> {
  const started = performance.now();
  try {
    const res = await db.query<T>(sql, params as unknown[]);
    logger.debug('db.query', { label, rows: res.rowCount, ms: Math.round(performance.now() - started) });
    return res.rows;
  } catch (e) {
    const err = mapDbError(e);
    logger.error('db.query_failed', { label, code: err.code, err: e });
    throw err;
  }
}

/** Exactly one row or null. */
export async function queryOne<T extends pg.QueryResultRow>(
  label: string,
  sql: string,
  params: Params = [],
  db?: Queryable,
): Promise<T | null> {
  const rows = await query<T>(label, sql, params, db);
  return rows[0] ?? null;
}

/** Runs fn inside BEGIN/COMMIT; any error rolls back and is rethrown as AppError. */
export async function withTransaction<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await getPool().connect();
  } catch (e) {
    const err = mapDbError(e);
    logger.error('db.connect_failed', { code: err.code, err: e });
    throw err;
  }
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch((rb: unknown) => logger.error('db.rollback_failed', { err: rb }));
    const err = mapDbError(e);
    if (err.cause === e) logger.error('db.transaction_failed', { code: err.code, err: e });
    throw err;
  } finally {
    client.release();
  }
}

export { mapDbError } from './errors';
