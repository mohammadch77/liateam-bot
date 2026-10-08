import 'server-only';
import pg from 'pg';

// BIGINT/NUMERIC as JS numbers (RIAL amounts fit easily below 2^53).
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const g = globalThis;
g.__liaPool ??= new pg.Pool({ connectionString: process.env.DASHBOARD_DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
export const pool = g.__liaPool;

export const q = async (sql, params) => (await pool.query(sql, params)).rows;

/** Runs fn(client) inside a transaction. */
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
