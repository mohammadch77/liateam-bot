// First «روتین پوستی» packs: one per skin type (oily, dry, combination, sensitive), five steps each (cleanser, toner,
// serum, cream, sunscreen), 10% off. Products are picked by a written rule (below) — a starting point the admin
// confirms or changes in /admin/packs. Does nothing when the collection already exists (never overwrites edits).
//   npm run seed:packs            (prints the choices)
//   npm run seed:packs -- --dry   (only prints, writes nothing)
// Uses DATABASE_URL + DB_SCHEMA (the app role is enough). Locally from .env.local; on the server:
//   set -a; . /opt/liateam-shop/env/staging.env; set +a; npm run seed:packs
//
// The rule, per step and skin type:
//   candidates  visible products in the step's categories (Liateam's tree), minus the ones for another body area
//               (eye, lip, brow, hand, neck), tinted sunscreens (a shade to choose) and refill bottles;
//   score 3     the skin type is named in the product's «نوع پوست» spec row or in its name;
//   score 2     a «مناسب برای» concern names it (چربی / خشکی / پوست حساس …);
//   score 1     made for every skin type («انواع پوست», or no skin type given at all);
//   excluded    names only other skin types (e.g. «پوست خشک و حساس» for oily skin);
//   exception   a sensitive-skin cream must name sensitive skin (score 2+): an «انواع پوست» cream is not enough
//               (the best one was a brightening / anti-spot cream), so without one the step stays «به‌زودی»;
//   then        in stock first, then the most reviews on Liateam (popularity), then the lower id.
// No candidate with a score → the step stays empty and the shop shows «به‌زودی» (never a wrong product).
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

const COLLECTION = { slug: 'skin-routine', title: 'روتین پوستی', variantLabel: 'نوع پوست' };
const SKINS = [
  { key: 'oily', title: 'پوست چرب', word: /چرب/, concern: /چربی/ },
  { key: 'dry', title: 'پوست خشک', word: /خشک/, concern: /خشکی/ },
  { key: 'combination', title: 'پوست مختلط', word: /مختلط/, concern: /مختلط/ },
  { key: 'sensitive', title: 'پوست حساس', word: /حساس/, concern: /حساس/, strictSteps: ['کرم'] },
];
const ALL_TYPES = /چرب|خشک|مختلط|حساس|نرمال/;
// Liateam category codes (their tree, 2026-10): cleansers 190 → 191 gel, 193 micellar, 194 bi-phase, 195 foam
const STEPS = [
  { label: 'پاک‌کننده', categories: [190] },
  { label: 'تونر', categories: [192] },
  { label: 'سرم', categories: [155] },
  { label: 'کرم', categories: [165] },
  { label: 'ضدآفتاب', categories: [170] },
];
const NOT_FACE = /چشم|لب|ابرو|مژه|دست|گردن|رنگی|شارژ/;

const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema},public` });
await client.connect();
try {
  const exists = await client.query('SELECT 1 FROM pack_collections WHERE slug = $1', [COLLECTION.slug]);
  if (exists.rowCount && !dry) {
    console.log(`«${COLLECTION.title}» already exists — nothing changed (edit it in /admin/packs).`);
    process.exit(0);
  }
  const choose = async (step, skin) => {
    const { rows } = await client.query(
      `WITH RECURSIVE t(code) AS (SELECT unnest($1::int[]) UNION SELECT c.code FROM categories c JOIN t ON c.parent_code = t.code)
       SELECT p.id, p.name, p.stock, coalesce(p.reviews_total, 0) AS reviews,
              (SELECT string_agg(a.value, ' / ') FROM public.product_attributes a
                WHERE a.product_id = p.id AND a.key = 'نوع پوست') AS skin,
              (SELECT string_agg(c.title, ' / ') FROM public.product_concerns c WHERE c.product_id = p.id) AS concerns
         FROM product_catalog p
        WHERE p.is_sellable AND p.price > 0 AND p.missing_since IS NULL AND p.category && ARRAY(SELECT code FROM t)`,
      [step.categories],
    );
    const scored = rows
      .filter((r) => !NOT_FACE.test(r.name))
      .map((r) => {
        const text = `${r.skin ?? ''} ${r.name}`;
        let score = 0;
        let why = '';
        if (skin.word.test(text)) [score, why] = [3, r.skin ? `نوع پوست: ${r.skin}` : 'نام محصول'];
        else if (skin.concern.test(r.concerns ?? '')) [score, why] = [2, 'مناسب برای'];
        else if (!ALL_TYPES.test(text))
          [score, why] = [1, r.skin ? `همه‌ی پوست‌ها (${r.skin})` : 'همه‌ی پوست‌ها'];
        return { ...r, score, why };
      })
      .filter((r) => r.score > (skin.strictSteps?.includes(step.label) ? 1 : 0))
      .sort(
        (a, b) => b.score - a.score || (b.stock > 0) - (a.stock > 0) || b.reviews - a.reviews || a.id - b.id,
      );
    return scored[0] ?? null;
  };

  const plan = [];
  for (const skin of SKINS) {
    const steps = [];
    for (const step of STEPS) steps.push({ step, pick: await choose(step, skin) });
    plan.push({ skin, steps });
  }
  for (const { skin, steps } of plan) {
    console.log(`\n${skin.title} (${skin.key})`);
    for (const { step, pick } of steps)
      console.log(
        `  ${step.label.padEnd(10)} ${pick ? `#${pick.id} ${pick.name.replace(/\s+/g, ' ')} — ${pick.why}${pick.stock > 0 ? '' : ' (ناموجود)'}, ${pick.reviews} دیدگاه` : 'به‌زودی (محصول مناسب پیدا نشد)'}`,
      );
  }
  if (dry) process.exit(0);

  await client.query('BEGIN');
  const { rows } = await client.query(
    `INSERT INTO pack_collections (slug, title, variant_label, active, sort_order) VALUES ($1, $2, $3, true, 0)
     RETURNING id`,
    [COLLECTION.slug, COLLECTION.title, COLLECTION.variantLabel],
  );
  const collectionId = rows[0].id;
  for (const [i, { skin, steps }] of plan.entries()) {
    const pack = await client.query(
      `INSERT INTO packs (collection_id, variant_key, variant_title, title, description, discount_kind, discount_value,
                          active, sort_order)
       VALUES ($1, $2, $3, $4, $5, 'percent', 10, true, $6) RETURNING id`,
      [
        collectionId,
        skin.key,
        skin.title,
        `روتین کامل ${skin.title}`,
        `پنج قدم مراقبت روزانه برای ${skin.title}، به ترتیب مصرف: پاک‌کننده، تونر، سرم، کرم و ضدآفتاب.`,
        i,
      ],
    );
    for (const [j, { step, pick }] of steps.entries())
      await client.query(
        'INSERT INTO pack_items (pack_id, step_label, product_id, sort_order) VALUES ($1, $2, $3, $4)',
        [pack.rows[0].id, step.label, pick?.id ?? null, j],
      );
  }
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, meta)
     VALUES (NULL, 'pack.seed', 'pack_collection', $1, $2::jsonb)`,
    [String(collectionId), JSON.stringify({ slug: COLLECTION.slug, packs: plan.length })],
  );
  await client.query('COMMIT');
  console.log(`\n«${COLLECTION.title}» created with ${plan.length} packs (10% off).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  await client.end();
}
