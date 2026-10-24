// One-off (after the change «packs start with no discount»): the packs that seed:packs created with its old fixed
// 10% go back to no discount (0%), so each pack costs exactly the sum of its products until the admin decides
// otherwise in /admin/packs. Only the seeded collection «skin-routine» and only packs still at the seed's exact
// value (percent, 10) are touched; any pack the admin changed keeps its discount. Each change is written to the audit
// log (action pack.discount_reset). Run once per environment; running it again changes nothing.
//   npm run packs:reset-discount -- --dry    (lists what would change, writes nothing)
//   npm run packs:reset-discount
// Uses DATABASE_URL + DB_SCHEMA (the app role is enough: UPDATE only). On the server:
//   set -a; . <the shop's .env>; set +a; npm run packs:reset-discount -- --dry
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));
const { DATABASE_URL: url, DB_SCHEMA: schema } = process.env;
if (!url || !schema || !/^shop(_staging)?$/.test(schema)) {
  console.error('DATABASE_URL and DB_SCHEMA (shop | shop_staging) are required.');
  process.exit(1);
}
const dry = process.argv.includes('--dry');

const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema},public` });
await client.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT p.id::int, p.variant_key, p.title
       FROM packs p JOIN pack_collections c ON c.id = p.collection_id
      WHERE c.slug = 'skin-routine' AND p.discount_kind = 'percent' AND p.discount_value = 10
      ORDER BY p.id
        FOR UPDATE OF p`,
  );
  for (const r of rows) console.log(`  pack ${r.id} (${r.variant_key}) «${r.title}»: 10% → 0%`);
  if (!rows.length) console.log('nothing to change: no seeded pack is still at 10%.');
  if (dry || !rows.length) {
    await client.query('ROLLBACK');
    if (dry && rows.length) console.log(`--dry: ${rows.length} pack(s) would change; nothing written.`);
  } else {
    await client.query(`UPDATE packs SET discount_value = 0 WHERE id = ANY($1::bigint[])`, [
      rows.map((r) => r.id),
    ]);
    for (const r of rows)
      await client.query(
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta)
         VALUES (NULL, 'pack.discount_reset', 'pack', $1, $2::jsonb)`,
        [
          String(r.id),
          JSON.stringify({ before: { kind: 'percent', value: 10 }, after: { kind: 'percent', value: 0 } }),
        ],
      );
    await client.query('COMMIT');
    console.log(`${rows.length} pack(s) now have no discount.`);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`packs:reset-discount failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
