// Takes the admin role away from a number and signs it out everywhere. Safe to run again.
//   npm run admin:revoke -- --mobile=09XXXXXXXXX            refuses to remove the LAST admin
//   npm run admin:revoke -- --mobile=09XXXXXXXXX --allow-last
// Removing a role row is a DELETE, which the shop's app role does not have (by design). So this script uses
// MIGRATION_DATABASE_URL (the schema owner), exactly like `npm run migrate`; run it on the server where that variable is
// set. Recorded in audit_log. The account itself and its customer role stay.
import { maskMobile } from '../src/lib/phone.mjs';
import { connect, fail, readArgs, scrub } from './_admin-db.mjs';

const NAME = 'admin:revoke';
const { phone, flags } = readArgs(NAME, ['--allow-last']);
const client = await connect(NAME, 'MIGRATION_DATABASE_URL');
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL FOR UPDATE`,
    [phone],
  );
  if (!rows.length) throw new Error('no account with this number');
  const id = rows[0].id;
  const has = await client.query(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [id]);
  if (!has.rowCount) {
    await client.query('ROLLBACK');
    console.log(`• ${maskMobile(phone)} is not an admin (user #${id}); nothing changed`);
  } else {
    const others = await client.query(
      `SELECT count(*)::int AS n FROM user_roles r JOIN users u ON u.id = r.user_id
        WHERE r.role = 'admin' AND u.id <> $1 AND u.status = 'active' AND u.deleted_at IS NULL`,
      [id],
    );
    if (others.rows[0].n === 0 && !flags.has('--allow-last'))
      throw new Error('this is the last active admin; create another first (or pass --allow-last)');
    await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [id]);
    const out = await client.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
      [id],
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta)
       VALUES (NULL, 'role.revoke', 'user', $1, $2::jsonb)`,
      [String(id), JSON.stringify({ role: 'admin', via: 'cli', sessionsRevoked: out.rowCount })],
    );
    await client.query('COMMIT');
    console.log(
      `✔ ${maskMobile(phone)} is no longer an admin (user #${id}); ${out.rowCount} session(s) signed out — recorded in audit_log`,
    );
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  fail(NAME, scrub(e.message));
} finally {
  await client.end();
}
