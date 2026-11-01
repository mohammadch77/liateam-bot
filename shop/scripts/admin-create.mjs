// Makes a number an admin: creates the account if there is none, otherwise upgrades it. Safe to run again.
//   npm run admin:create -- --mobile=09XXXXXXXXX
// The number is only this argument (never in the repository). Recorded in audit_log. Uses DATABASE_URL (the app role is
// enough: a role is INSERTed). Sign in afterwards with the usual OTP at /login. Take the admin away with `admin:revoke`.
import { maskMobile } from '../src/lib/phone.ts';
import { connect, fail, readArgs, scrub } from './_admin-db.mjs';

const NAME = 'admin:create';
const { phone } = readArgs(NAME);
const client = await connect(NAME, 'DATABASE_URL');
try {
  await client.query('BEGIN');
  const ins = await client.query(
    `INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) WHERE deleted_at IS NULL DO NOTHING RETURNING id`,
    [phone],
  );
  const created = ins.rowCount === 1;
  const { rows } = await client.query(
    `SELECT id, status FROM users WHERE phone = $1 AND deleted_at IS NULL`,
    [phone],
  );
  const { id, status } = rows[0];
  if (status !== 'active')
    throw new Error(`the account is ${status}; activate it first (this script does not change status)`);
  // a new account is also an ordinary customer, as after a sign-up
  if (created)
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer') ON CONFLICT DO NOTHING`,
      [id],
    );
  const granted = await client.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id, role) DO NOTHING RETURNING role`,
    [id],
  );
  if (granted.rowCount)
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta)
       VALUES (NULL, 'role.grant', 'user', $1, $2::jsonb)`,
      [String(id), JSON.stringify({ role: 'admin', via: 'cli', newUser: created })],
    );
  await client.query('COMMIT');
  console.log(
    granted.rowCount
      ? `✔ ${maskMobile(phone)} is now an admin (user #${id}${created ? ', account created' : ''}) — recorded in audit_log`
      : `• ${maskMobile(phone)} is already an admin (user #${id}); nothing changed`,
  );
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  fail(NAME, scrub(e.message));
} finally {
  await client.end();
}
