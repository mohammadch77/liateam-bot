// Shared by admin-create.mjs and admin-revoke.mjs: environment, argument parsing and the database connection.
// The mobile number is only ever an argument (never stored in the repository); it is shown masked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { normalizeMobile } from '../src/lib/phone.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const f of ['.env.local', '.env'])
  if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f)); // never overrides variables already set

export const scrub = (m) => String(m).replace(/\w+:\/\/[^@\s]+@/g, '***@');
export const fail = (name, m) => {
  console.error(`\n[${name}] ${m}\n`);
  process.exit(1);
};

/** --mobile=09XXXXXXXXX or --mobile 09XXXXXXXXX, plus the flags named in `flags` */
export function readArgs(name, flags = []) {
  const argv = process.argv.slice(2);
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = argv[i].split(/=(.*)/s);
    if (k === '--mobile') out.mobile = v ?? argv[++i];
    else if (flags.includes(k)) out.flags.add(k);
    else
      fail(
        name,
        `unknown argument ${k}\nusage: npm run ${name} -- --mobile=09XXXXXXXXX${flags.map((f) => ` [${f}]`).join('')}`,
      );
  }
  out.phone = normalizeMobile(out.mobile ?? '');
  if (!out.phone)
    fail(name, `usage: npm run ${name} -- --mobile=09XXXXXXXXX   (not a valid Iranian mobile number)`);
  return out;
}

/**
 * A connected client on the shop schema. `urlVar` picks the role: DATABASE_URL (the app role: it may INSERT, so it can
 * make an admin) or MIGRATION_DATABASE_URL (the schema owner: only it may DELETE a role row).
 */
export async function connect(name, urlVar) {
  const url = process.env[urlVar];
  const schema = process.env.DB_SCHEMA;
  if (!url || !schema || !/^shop(_staging)?$/.test(schema))
    fail(name, `${urlVar} and DB_SCHEMA (shop | shop_staging) are required.`);
  const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema},public` });
  await client.connect().catch((e) => fail(name, scrub(e.message)));
  return client;
}
