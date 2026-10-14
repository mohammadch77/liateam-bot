// Runs the SQL migrations in ./migrations against ONE shop schema.
//   npm run migrate:up                 apply all pending
//   npm run migrate:down               revert the last one
//   npm run migrate:down -- all        revert everything (staging/dev only)
//   npm run migrate:status             list applied / pending
// Needs MIGRATION_DATABASE_URL (the schema owner role, not the app role) and DB_SCHEMA.
// Locally they are read from .env.local; on the server from the environment file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'migrations');
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) process.loadEnvFile(p); // never overrides variables already set
}

const fail = (msg) => {
  process.stderr.write(`\n[migrate] ${msg}\n\n`);
  process.exit(1);
};

const { MIGRATION_DATABASE_URL: url, DB_SCHEMA: schema, APP_ENV: appEnv } = process.env;
if (!url) fail('MIGRATION_DATABASE_URL is not set (schema owner role, see README).');
if (!schema || !/^shop(_staging)?$/.test(schema)) fail('DB_SCHEMA must be "shop" or "shop_staging".');
if (appEnv === 'production' && schema !== 'shop') fail('APP_ENV=production requires DB_SCHEMA=shop.');
if (appEnv !== 'production' && schema === 'shop')
  fail('DB_SCHEMA=shop is production; set APP_ENV=production.');

const [cmd = 'up', arg] = process.argv.slice(2);
const log = (m) => process.stdout.write(m.replace(/\w+:\/\/[^@\s]+@/g, '***@') + '\n');
const base = {
  databaseUrl: url,
  dir,
  schema, // search_path for the migrations
  migrationsSchema: schema, // pgmigrations lives next to the tables, never in public
  migrationsTable: 'pgmigrations',
  createSchema: false, // the schema comes from deploy/shop-db-roles.sql with the right owner
  createMigrationsSchema: false,
  checkOrder: true,
  log,
};

async function status() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client
      .query(
        `SELECT name, to_char(run_on, 'YYYY-MM-DD HH24:MI:SS') AS run_on FROM ${pg.escapeIdentifier(schema)}.pgmigrations ORDER BY id`,
      )
      .catch((e) => (e.code === '42P01' ? { rows: [] } : Promise.reject(e)));
    const done = new Map(rows.map((r) => [r.name, r.run_on]));
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    log(`schema ${schema}:`);
    for (const f of files) {
      const name = f.replace(/\.sql$/, '');
      log(`  ${done.has(name) ? '✔ applied ' + done.get(name) : '… pending'}  ${name}`);
    }
  } finally {
    await client.end();
  }
}

try {
  if (cmd === 'status') await status();
  else if (cmd === 'up') await runner({ ...base, direction: 'up' });
  else if (cmd === 'down') {
    if (arg === 'all' && appEnv === 'production') fail('"down all" is refused in production.');
    await runner({ ...base, direction: 'down', count: arg === 'all' ? Infinity : Number(arg ?? 1) });
  } else fail(`unknown command "${cmd}" (up | down [n|all] | status)`);
} catch (e) {
  fail(`${e.message?.replace(/\w+:\/\/[^@\s]+@/g, '***@') ?? e}`);
}
