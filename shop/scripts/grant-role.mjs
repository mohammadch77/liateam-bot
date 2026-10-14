// Grants a role to a phone number (creates the account if it does not exist yet), recorded in audit_log.
//   npm run grant-role -- 09121234567 admin
// Roles: customer | affiliate | support | employee | admin. Uses DATABASE_URL + DB_SCHEMA (the app role is enough).
// Locally read from .env.local; on the server: set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run …
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { normalizeMobile, maskMobile } from '../src/lib/phone.ts';

const ROLES = ['customer', 'affiliate', 'support', 'employee', 'admin'];
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));

const fail = (m) => {
  console.error(`\n[grant-role] ${m}\n`);
  process.exit(1);
};
const [phoneArg, role] = process.argv.slice(2);
const phone = normalizeMobile(phoneArg ?? '');
if (!phone) fail('usage: npm run grant-role -- 09XXXXXXXXX <role>   (phone is not a valid Iranian mobile)');
if (!ROLES.includes(role)) fail(`role must be one of: ${ROLES.join(', ')}`);
const { DATABASE_URL: url, DB_SCHEMA: schema } = process.env;
if (!url || !schema || !/^shop(_staging)?$/.test(schema))
  fail('DATABASE_URL and DB_SCHEMA (shop | shop_staging) are required.');

const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema},public` });
await client.connect();
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
  const userId = rows[0].id;
  if (created) {
    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer') ON CONFLICT DO NOTHING`,
      [userId],
    );
  }
  const granted = await client.query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING RETURNING role`,
    [userId, role],
  );
  if (granted.rowCount) {
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta)
       VALUES (NULL, 'role.grant', 'user', $1, $2::jsonb)`,
      [String(userId), JSON.stringify({ role, via: 'cli', newUser: created })],
    );
  }
  await client.query('COMMIT');
  console.log(
    granted.rowCount
      ? `✔ ${maskMobile(phone)} is now ${role} (user #${userId}${created ? ', account created' : ''}) — recorded in audit_log`
      : `• ${maskMobile(phone)} already has role ${role} (user #${userId})`,
  );
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  fail(e.message.replace(/\w+:\/\/[^@\s]+@/g, '***@'));
} finally {
  await client.end();
}
