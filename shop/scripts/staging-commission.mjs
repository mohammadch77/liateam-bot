// Staging only: credits ONE test commission row to an affiliate's wallet, so withdrawals can be tried before the commission payout
// (task G) exists. It refuses to run unless APP_ENV=staging, and writes through the same append-only ledger (a normal row, never an edit).
//   npm run staging:commission -- --mobile=09XXXXXXXXX --amount=500000
import pg from 'pg';
import { fail, readArgs, scrub } from './_admin-db.mjs';

const NAME = 'staging:commission';
if (process.env.APP_ENV !== 'staging') fail(NAME, 'refused: this script runs only when APP_ENV=staging.');
const amountArg = process.argv.find((a) => a.startsWith('--amount='));
const amount = Number(amountArg?.split('=')[1]);
if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 50_000_000)
  fail(NAME, 'usage: npm run staging:commission -- --mobile=09XXXXXXXXX --amount=<1000..50000000 toman>');
process.argv = process.argv.filter((a) => !a.startsWith('--amount='));
const { phone } = readArgs(NAME);
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) fail(NAME, 'DATABASE_URL is not set');
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const schema = (process.env.DB_SCHEMA || 'shop_staging').replace(/[^a-z0-9_]/gi, '');
  await client.query(`SET search_path = ${schema}, public`);
  const u = await client.query('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL', [phone]);
  if (!u.rows[0]) fail(NAME, 'no user with that number');
  const key = `staging-commission:${u.rows[0].id}:${Date.now()}`;
  const r = await client.query(
    `INSERT INTO wallet_ledger (user_id, kind, amount, balance_after, idempotency_key, note)
     VALUES ($1, 'commission', $2, 0, $3, 'staging test commission') RETURNING balance_after`,
    [u.rows[0].id, amount, key],
  );
  console.log(`credited ${amount} toman test commission; balance now ${r.rows[0].balance_after}`);
} catch (e) {
  fail(NAME, scrub(e instanceof Error ? e.message : e));
} finally {
  await client.end().catch(() => {});
}
