import pg from 'pg';
import { config } from './config.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS supplier_products (
  id            INTEGER PRIMARY KEY,          -- supplier code
  uuid          UUID,
  name          TEXT    NOT NULL,
  price         BIGINT  NOT NULL,             -- selling price, TOMAN (Liateam consumer price; see normalize.mjs)
  cost_price    BIGINT  NOT NULL,             -- payable_price, TOMAN, internal only
  stock         INTEGER NOT NULL,
  category      INTEGER[] NOT NULL DEFAULT '{}',
  is_available  BOOLEAN,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS supplier_price_history (
  product_id  INTEGER NOT NULL REFERENCES supplier_products(id),
  price       BIGINT  NOT NULL,
  cost_price  BIGINT  NOT NULL,
  stock       INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL,                  -- ok | warning | failed
  fetched     INTEGER,
  written     INTEGER,
  rejected    INTEGER,
  message     TEXT
);
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS is_sellable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS sellable INTEGER;
ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS failure_kind TEXT;   -- auth | structure | coverage | database | error
UPDATE sync_runs SET status = 'warning' WHERE status = 'partial';

-- Supplier category tree. name is NULL for codes seen on products but never named by the supplier.
CREATE TABLE IF NOT EXISTS categories (
  code        INTEGER PRIMARY KEY,
  name        TEXT,
  parent_code INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Liateam's official tree (categories.mjs parseOfficialTree): position = its menu order; type = product | accessory;
-- in_source = false once Liateam no longer lists the code (kept so old product rows still join, but never shown).
ALTER TABLE categories ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS in_source BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS missing_since TIMESTAMPTZ;  -- set while the supplier no longer lists it
-- From each product's own page (product-details.mjs). Content columns change only when the text changes;
-- details_checked_at only schedules the next visit (one product page per product per week, spread over runs).
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS description TEXT;            -- plain structured text, never HTML
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS details_checked_at TIMESTAMPTZ;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS details_updated_at TIMESTAMPTZ;
-- Rich product-page sections (product-details.mjs parseRich). Plain text only; written per section, only when
-- that section's hash (content_hashes) changed. Nothing here is a price.
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS brand_code INTEGER;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS how_to_use TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS video_url TEXT;          -- mp4 on Liateam's ArvanCloud VOD only
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS video_embed_url TEXT;    -- ArvanCloud player URL only, never HTML
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS rating_value SMALLINT;   -- % of buyers who recommend it (0-100)
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS reviews_total INTEGER;   -- reviews on Liateam (we keep the newest 10)
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS origin_country TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS content_hashes JSONB;    -- {section: hash}; NULL = never read
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS gallery_count INTEGER NOT NULL DEFAULT 0;  -- rows in product_images
-- Product facts from its page («facts» section): size, Liateam's product colour (gallery backdrop), shelf life, and
-- Liateam's own meta texts (kept for reference only: the shop builds its own meta from name + brand + size).
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS measurement_value NUMERIC(10,2);
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS measurement_unit TEXT;   -- 'ml' | 'g'
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS color TEXT;              -- #rrggbb
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS expire_months SMALLINT;  -- shelf life after production
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS meta_title TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS meta_description TEXT;
-- English slug (slug.mjs): assigned once, never rewritten; slug_fa = the Persian slug of that moment (redirects).
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS slug_en TEXT;
ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS slug_fa TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_slug_en ON supplier_products (slug_en);
CREATE TABLE IF NOT EXISTS brands (
  code       INTEGER PRIMARY KEY,               -- Liateam brand code
  name       TEXT NOT NULL,                     -- Persian name as Liateam shows it
  latin_name TEXT,                              -- only when Liateam provides one
  slug       TEXT NOT NULL UNIQUE,              -- ASCII, from latin_name or the transliterated name
  image_url  TEXT,
  position   INTEGER,                           -- Liateam's order
  in_source  BOOLEAN NOT NULL DEFAULT true,     -- false once Liateam no longer lists it (kept for old rows)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_attributes (  -- «مشخصات»: key/value rows in Liateam's order
  product_id INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (product_id, position)
);
CREATE TABLE IF NOT EXISTS product_faqs (
  product_id INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  PRIMARY KEY (product_id, position)
);
CREATE TABLE IF NOT EXISTS product_reviews (     -- newest reviews from Liateam; author masked ("نام ف.")
  product_id  INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  source_code INTEGER,
  author      TEXT,
  rating      SMALLINT,                         -- 1-10, NULL = a comment without a score
  body        TEXT NOT NULL,
  reply       TEXT,                             -- Liateam's answer
  created_at  TIMESTAMPTZ,
  PRIMARY KEY (product_id, position)
);
CREATE TABLE IF NOT EXISTS product_images (     -- extra photos in Liateam's order; the main one stays image_url
  product_id INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  url        TEXT NOT NULL,                     -- https://s3.liateam.ir/… only (product-details.mjs IMAGE_HOST)
  alt        TEXT,
  PRIMARY KEY (product_id, position)
);
CREATE TABLE IF NOT EXISTS hero_slides (        -- Liateam home-page hero slides we can link on our site, in order
  position     INTEGER PRIMARY KEY,
  source_code  INTEGER,                          -- Liateam's slide code
  image_url    TEXT NOT NULL,                    -- https://s3.liateam.ir/… only (hero.mjs IMAGE_HOST), wide
  portrait_url TEXT,                             -- tall photo for phones, same host
  color        TEXT,                             -- #rrggbb backdrop while the photo loads
  alt          TEXT,
  target_type  TEXT NOT NULL CHECK (target_type IN ('product', 'category')),
  target_code  INTEGER NOT NULL,                 -- supplier_products.id or categories.code
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_concerns (   -- «مناسب برای»: skin/hair concerns in Liateam's order
  product_id INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  code       INTEGER,
  title      TEXT NOT NULL,
  image_url  TEXT,                              -- https://s3.liateam.ir/… only
  PRIMARY KEY (product_id, position)
);
CREATE TABLE IF NOT EXISTS product_tags (       -- Liateam's search tags (best-selling, newest, …)
  product_id INTEGER NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  code       INTEGER,
  key        TEXT,
  title      TEXT,
  PRIMARY KEY (product_id, position)
);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS banner_url TEXT;           -- brand page banner, wide (Liateam host only)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS banner_portrait_url TEXT;  -- same, tall (phones)
-- What changed in the catalog, run by run (shown in the dashboard; not only failures).
CREATE TABLE IF NOT EXISTS product_events (
  id         SERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,                  -- new | removed | returned | price | cost | out_of_stock | back_in_stock | name
  old_value  TEXT,
  new_value  TEXT
);
CREATE INDEX IF NOT EXISTS product_events_at ON product_events (at DESC);
-- Product + category names; unnamed/unknown categories show as their code (never an error).
-- CREATE OR REPLACE (not DROP) keeps the dashboard role's grant; new columns may only be appended at the end.
CREATE OR REPLACE VIEW product_catalog AS
SELECT p.id, p.uuid, p.name, p.price, p.cost_price, p.stock, p.category, p.is_available, p.is_sellable,
       p.first_seen_at, p.updated_at, p.last_seen_at,
       COALESCE((SELECT array_agg(COALESCE(c.name, '#' || x.code) ORDER BY x.ord)
                   FROM unnest(p.category) WITH ORDINALITY AS x(code, ord)
                   LEFT JOIN categories c ON c.code = x.code), '{}') AS category_names,
       p.image_url, p.missing_since,
       p.description, p.brand,
       p.brand_code, p.slug_en, p.slug_fa, p.summary, p.features, p.how_to_use, p.video_url, p.video_embed_url,
       p.rating_value, p.reviews_total, p.origin_country, p.gallery_count,
       p.measurement_value, p.measurement_unit, p.color, p.expire_months
  FROM supplier_products p;

-- Alert lines of each run (also in logs/alerts.log); read by the dashboard.
CREATE TABLE IF NOT EXISTS sync_alerts (
  id         SERIAL PRIMARY KEY,
  run_id     INTEGER REFERENCES sync_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level      TEXT NOT NULL,                  -- warning | failed
  message    TEXT NOT NULL
);
-- Runtime settings edited from the dashboard; missing keys fall back to src/config.mjs.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,               -- excludedCategories | sellableOverrides | priceJumpLimit | intervalHours
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings_audit (
  id        SERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,                   -- setting key, or 'manual_run'
  old_value JSONB,
  new_value JSONB
);
-- Manual run requests from the dashboard, picked up by src/worker.mjs.
CREATE TABLE IF NOT EXISTS run_requests (
  id           SERIAL PRIMARY KEY,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by TEXT NOT NULL,
  picked_at    TIMESTAMPTZ
);
ALTER TABLE run_requests ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;  -- result sent back to the messenger user who asked
-- People linked to the Telegram / Bale bots (via a one-time invite code from the dashboard).
CREATE TABLE IF NOT EXISTS messenger_chats (
  id           SERIAL PRIMARY KEY,
  platform     TEXT NOT NULL,                -- telegram | bale
  chat_id      BIGINT NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'viewer', -- admin (sees cost/profit, manual run, interval) | viewer
  notify       BOOLEAN NOT NULL DEFAULT true,
  kinds        TEXT[] NOT NULL DEFAULT '{price,stock,catalog,errors,daily}',
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  UNIQUE (platform, chat_id)
);
ALTER TABLE messenger_chats ALTER COLUMN kinds SET DEFAULT '{price,stock,catalog,errors,daily}';
CREATE TABLE IF NOT EXISTS messenger_invites (
  id         SERIAL PRIMARY KEY,
  code_hash  TEXT NOT NULL,                  -- sha256 of the 6-digit code; the code itself is never stored
  role       TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  used_by    TEXT
);
-- One-time audit: every product checked once on its own page (models / own prices / listing match).
CREATE TABLE IF NOT EXISTS product_audit (
  product_id       INTEGER PRIMARY KEY,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok               BOOLEAN NOT NULL,            -- false = page could not be read (retried later)
  price_matches    BOOLEAN,
  prices           BIGINT[],                    -- distinct selling prices found for this code on its page
  variant_codes    INTEGER[],
  missing_variants INTEGER[],                   -- sibling models we do not sync (should stay empty)
  attempts         INTEGER NOT NULL DEFAULT 1   -- unreadable pages are retried, at most 3 times
);
-- Non-secret health facts written by the bot (session expiry, telegram configured, worker heartbeat).
CREATE TABLE IF NOT EXISTS bot_status (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- shop orders (src/orders.mjs)
-- Work for the orders service. Writers (dashboard, messenger, later the NestJS site) only INSERT here;
-- the orders service is the only process that talks to Liateam about orders and writes the tables below.
CREATE TABLE IF NOT EXISTS order_jobs (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,                  -- review | create | place
  payload      JSONB NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_at    TIMESTAMPTZ,
  done_at      TIMESTAMPTZ,
  ok           BOOLEAN,
  result       JSONB
);
CREATE INDEX IF NOT EXISTS order_jobs_pending ON order_jobs (id) WHERE picked_at IS NULL;
CREATE OR REPLACE FUNCTION order_jobs_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('order_jobs', NEW.id::text); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS order_jobs_notify ON order_jobs;
CREATE TRIGGER order_jobs_notify AFTER INSERT ON order_jobs FOR EACH ROW EXECUTE FUNCTION order_jobs_notify();

CREATE TABLE IF NOT EXISTS shop_orders (
  id                  SERIAL PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- queued: customer paid, waiting for an admin to place it | placing | awaiting_payment: placed at
  -- Liateam, payment link sent | supplier_paid | sent | refunded (nothing could be placed) | canceled
  status              TEXT NOT NULL DEFAULT 'queued',
  urgent              BOOLEAN NOT NULL DEFAULT false, -- has an item with little stock: place it soon
  customer_first_name TEXT NOT NULL,
  customer_last_name  TEXT NOT NULL,
  customer_mobile     TEXT NOT NULL,
  province_id         INTEGER NOT NULL,
  city_id             INTEGER NOT NULL,
  postal_code         TEXT NOT NULL,
  address             TEXT NOT NULL,
  plate               TEXT NOT NULL,
  unit                TEXT,
  items_total         BIGINT NOT NULL,         -- TOMAN, what the customer paid for goods
  shipping_price      BIGINT NOT NULL,         -- TOMAN, what the customer paid for shipping
  refunded_total      BIGINT NOT NULL DEFAULT 0,
  liateam_order_code  TEXT,
  liateam_address_id  TEXT,
  liateam_total       BIGINT,                  -- what we pay Liateam (goods + shipping)
  payment_url         TEXT,
  placed_at           TIMESTAMPTZ,
  placed_by           TEXT,
  supplier_paid_at    TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  tracking            JSONB,
  reminded_at         TIMESTAMPTZ,
  last_error          TEXT,
  dry_run_result      JSONB
);
CREATE TABLE IF NOT EXISTS shop_order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  unit_price  BIGINT NOT NULL,                 -- TOMAN charged to the customer
  unit_cost   BIGINT,                          -- TOMAN paid to Liateam when placed
  status      TEXT NOT NULL DEFAULT 'ok'       -- ok | refunded (not available when placing)
);
-- Cinema-style hold: quantities shown in an order review are kept for that customer until the
-- review expires (15 min) or turns into an order. Only inside our system - Liateam holds nothing.
CREATE TABLE IF NOT EXISTS review_holds (
  review_id  INTEGER NOT NULL REFERENCES order_jobs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (review_id, product_id)
);
-- Simulated customer wallet until the real site exists: + refund, - spend.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id              SERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_mobile TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  reason          TEXT NOT NULL,
  order_id        INTEGER REFERENCES shop_orders(id)
);
-- What happened to an order; the messenger sends these to admins (notified_at) - payment link included.
CREATE TABLE IF NOT EXISTS shop_order_events (
  id          SERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  order_id    INTEGER REFERENCES shop_orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                   -- new | placed | paid | sent | refund | price | reminder | error | canceled
  message     TEXT NOT NULL,
  data        JSONB,
  notified_at TIMESTAMPTZ
);
CREATE OR REPLACE FUNCTION shop_order_events_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('shop_order_events', NEW.id::text); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS shop_order_events_notify ON shop_order_events;
CREATE TRIGGER shop_order_events_notify AFTER INSERT ON shop_order_events FOR EACH ROW EXECUTE FUNCTION shop_order_events_notify();`;

export async function openDb() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  await client.query(SCHEMA);
  return client;
}

export async function loadPrevious(db) {
  const { rows } = await db.query('SELECT id, name, price, cost_price, stock, missing_since FROM supplier_products');
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Products whose page should be read for brand/description this run: never checked first, then the oldest
 * check older than `maxAgeDays`. Only products still listed by the supplier.
 */
export async function detailsDue(db, limit, maxAgeDays) {
  const { rows } = await db.query(
    `SELECT id FROM supplier_products
      WHERE missing_since IS NULL
        AND (details_checked_at IS NULL OR content_hashes IS NULL OR NOT content_hashes ? 'facts'
             OR details_checked_at < now() - make_interval(days => $2))
      ORDER BY COALESCE(content_hashes ? 'facts', false), details_checked_at NULLS FIRST, id
      LIMIT $1`,
    [limit, maxAgeDays],
  );
  return rows.map((r) => r.id);
}

/**
 * Stores brand/description only when they differ from what is stored (IS DISTINCT FROM), so an unchanged page
 * rewrites nothing; details_checked_at alone records the visit. Price, stock, updated_at are never touched.
 * @returns 'changed' | 'unchanged'
 */
export async function saveDetails(db, id, { brand, description }) {
  const { rowCount } = await db.query(
    `UPDATE supplier_products SET brand = $2, description = $3, details_updated_at = now(), details_checked_at = now()
      WHERE id = $1 AND (brand IS DISTINCT FROM $2 OR description IS DISTINCT FROM $3)`,
    [id, brand, description],
  );
  if (rowCount) return 'changed';
  await db.query('UPDATE supplier_products SET details_checked_at = now() WHERE id = $1', [id]);
  return 'unchanged';
}

/**
 * Rich sections of one product page: only the sections whose hash differs from content_hashes are written
 * (child rows replaced in one transaction). An unchanged page writes nothing but content_hashes stays as is.
 * @returns the names of the sections that changed ([] = nothing written)
 */
export async function saveRich(db, id, rich, hashes) {
  // brand banners: per brand, not per product (no hash); written only when they differ
  if (rich.brandCode && (rich.brandBanner || rich.brandBannerPortrait)) {
    await db.query(
      `UPDATE brands SET banner_url = COALESCE($2, banner_url), banner_portrait_url = COALESCE($3, banner_portrait_url), updated_at = now()
        WHERE code = $1 AND (banner_url, banner_portrait_url) IS DISTINCT FROM (COALESCE($2, banner_url), COALESCE($3, banner_portrait_url))`,
      [rich.brandCode, rich.brandBanner, rich.brandBannerPortrait]);
  }
  const { rows: [row] } = await db.query('SELECT content_hashes FROM supplier_products WHERE id = $1', [id]);
  if (!row) return [];
  const old = row.content_hashes ?? {};
  const changed = Object.keys(hashes).filter((k) => old[k] !== hashes[k]);
  if (!changed.length) return [];
  await db.query('BEGIN');
  try {
    const set = (cols) => db.query(
      `UPDATE supplier_products SET ${Object.keys(cols).map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...Object.values(cols)]);
    const replace = async (table, cols, items) => {
      await db.query(`DELETE FROM ${table} WHERE product_id = $1`, [id]);
      for (const [i, item] of items.entries()) {
        await db.query(
          `INSERT INTO ${table} (product_id, position, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, j) => `$${j + 3}`).join(', ')})`,
          [id, i, ...cols.map((c) => item[c])]);
      }
    };
    for (const s of changed) {
      if (s === 'summary') await set({ summary: rich.summary, features: rich.features });
      else if (s === 'how_to_use') await set({ how_to_use: rich.howToUse });
      else if (s === 'video') await set({ video_url: rich.video?.url ?? null, video_embed_url: rich.video?.embed ?? null });
      else if (s === 'meta') await set({ rating_value: rich.rating, brand_code: rich.brandCode, origin_country: rich.country });
      else if (s === 'attributes') await replace('product_attributes', ['key', 'value'], rich.attributes);
      else if (s === 'faqs') await replace('product_faqs', ['question', 'answer'], rich.faqs);
      else if (s === 'facts') {
        await set({ measurement_value: rich.measurement?.value ?? null, measurement_unit: rich.measurement?.unit ?? null,
          color: rich.color, expire_months: rich.expireMonths, meta_title: rich.metaTitle, meta_description: rich.metaDescription });
      }
      else if (s === 'concerns') await replace('product_concerns', ['code', 'title', 'image_url'], rich.concerns);
      else if (s === 'tags') await replace('product_tags', ['code', 'key', 'title'], rich.tags);
      else if (s === 'gallery') {
        await replace('product_images', ['url', 'alt'], rich.gallery);
        await set({ gallery_count: rich.gallery.length });
      }
      else if (s === 'reviews') {
        await replace('product_reviews', ['source_code', 'author', 'rating', 'body', 'reply', 'created_at'], rich.reviews);
        await set({ reviews_total: rich.total });
      }
    }
    await set({ content_hashes: JSON.stringify(hashes), details_updated_at: new Date() });
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  return changed;
}

/**
 * Mirrors Liateam's brand list (like syncCategories): upsert in its order; brands it no longer lists keep their
 * row with in_source = false. An empty list (page without the query) changes nothing.
 */
export async function syncBrands(db, brands, slugOf, knownLatin = {}) {
  if (!brands.length) return 0;
  const { rows } = await db.query('SELECT code, slug, latin_name FROM brands');
  const taken = new Map(rows.map((r) => [r.slug, r.code]));
  const stored = new Map(rows.map((r) => [r.code, r.latin_name]));
  for (const src of brands) {
    // Liateam's Latin name, else one set by hand earlier, else the known spelling
    const b = { ...src, latin: src.latin ?? stored.get(src.code) ?? knownLatin[src.name] ?? null };
    let slug = slugOf(b.latin ?? b.name) || `brand-${b.code}`;
    if (taken.has(slug) && taken.get(slug) !== b.code) slug = `${slug}-${b.code}`;
    taken.set(slug, b.code);
    await db.query(
      `INSERT INTO brands (code, name, latin_name, slug, image_url, position, in_source, banner_url, banner_portrait_url)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
       ON CONFLICT (code) DO UPDATE SET name = $2, latin_name = $3, slug = brands.slug, image_url = $5, position = $6,
         in_source = true, banner_url = COALESCE($7, brands.banner_url), banner_portrait_url = COALESCE($8, brands.banner_portrait_url),
         updated_at = CASE WHEN (brands.name, brands.latin_name, brands.image_url, brands.position, brands.in_source,
                                 brands.banner_url, brands.banner_portrait_url)
           IS DISTINCT FROM ($2, $3, $5, $6, true, COALESCE($7, brands.banner_url), COALESCE($8, brands.banner_portrait_url))
           THEN now() ELSE brands.updated_at END`,
      [b.code, b.name, b.latin, slug, b.image, b.position, b.banner ?? null, b.bannerPortrait ?? null]);
  }
  await db.query('UPDATE brands SET in_source = false WHERE NOT (code = ANY ($1)) AND in_source', [brands.map((b) => b.code)]);
  return brands.length;
}

/**
 * English + Persian slug for products that have none yet (assigned once; see slug.mjs). Brand Latin name =
 * brands.latin_name, else the brand's slug. Returns how many were assigned.
 */
export async function assignSlugs(db, englishSlug, persianSlug) {
  const { rows } = await db.query(
    `SELECT p.id, p.name, COALESCE(b.latin_name, b.slug) AS brand_latin
       FROM supplier_products p LEFT JOIN brands b ON b.code = p.brand_code
      WHERE p.slug_en IS NULL AND p.content_hashes IS NOT NULL AND (p.brand_code IS NULL OR b.code IS NOT NULL)`);
  for (const r of rows) {
    await db.query('UPDATE supplier_products SET slug_en = $2, slug_fa = $3 WHERE id = $1 AND slug_en IS NULL',
      [r.id, englishSlug({ code: r.id, name: r.name, brandLatin: r.brand_latin }), persianSlug(r.name)]);
  }
  return rows.length;
}

export async function upsertProducts(db, products) {
  await db.query('BEGIN');
  try {
    for (const p of products) {
      const { rows } = await db.query(
        `INSERT INTO supplier_products (id, uuid, name, price, cost_price, stock, category, is_available, is_sellable, image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           uuid=EXCLUDED.uuid, name=EXCLUDED.name, price=EXCLUDED.price, cost_price=EXCLUDED.cost_price,
           stock=EXCLUDED.stock, category=EXCLUDED.category, is_available=EXCLUDED.is_available, is_sellable=EXCLUDED.is_sellable,
           image_url=COALESCE(EXCLUDED.image_url, supplier_products.image_url),
           last_seen_at=now(), missing_since=NULL,
           updated_at = CASE WHEN (supplier_products.price, supplier_products.cost_price, supplier_products.stock)
                                IS DISTINCT FROM (EXCLUDED.price, EXCLUDED.cost_price, EXCLUDED.stock)
                             THEN now() ELSE supplier_products.updated_at END
         RETURNING (xmax = 0) AS inserted, updated_at = now() AS changed`,
        [p.id, p.uuid, p.name, p.price, p.cost_price, p.stock, p.category, p.is_available, p.is_sellable, p.image_url ?? null],
      );
      if (rows[0].inserted || rows[0].changed) {
        await db.query(
          'INSERT INTO supplier_price_history (product_id, price, cost_price, stock) VALUES ($1,$2,$3,$4)',
          [p.id, p.price, p.cost_price, p.stock],
        );
      }
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

export async function recordRun(db, run, alerts = []) {
  const { rows } = await db.query(
    `INSERT INTO sync_runs (started_at, status, fetched, written, sellable, rejected, duration_ms, failure_kind, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [run.startedAt, run.status, run.fetched, run.written, run.sellable, run.rejected, run.durationMs, run.failureKind, run.message],
  );
  for (const line of alerts) {
    await db.query('INSERT INTO sync_alerts (run_id, level, message) VALUES ($1,$2,$3)', [rows[0].id, run.status, line]);
  }
}

/**
 * Makes the categories table mirror Liateam's official tree: name, parent (a move back to the root included),
 * menu position and type exactly as Liateam has them; codes Liateam dropped get in_source=false. A row is
 * written only when something in it really changed. Without the official tree (`tree` null) the stored tree is
 * kept and only names are filled in, never overwritten with NULL. Codes used by products but absent from the
 * tree get a nameless row so the view's join stays total.
 * @returns {{ stored: number, changes: string[] }}
 */
export async function syncCategories(db, tree, named, usedCodes) {
  const changes = [];
  await db.query('BEGIN');
  try {
    if (tree) {
      const { rows: before } = await db.query('SELECT code, name, parent_code, position, type, in_source FROM categories');
      const old = new Map(before.map((r) => [r.code, r]));
      for (const c of tree) {
        const o = old.get(c.code);
        if (o && o.in_source && o.name === c.name && o.parent_code === c.parent_code && o.position === c.position && o.type === c.type) continue;
        changes.push(!o || !o.name ? `+${c.code} ${c.name}`
          : [o.name !== c.name && `${c.code}: «${o.name}» → «${c.name}»`,
             o.parent_code !== c.parent_code && `${c.code}: parent ${o.parent_code ?? 'root'} → ${c.parent_code ?? 'root'}`,
             o.position !== c.position && `${c.code}: position ${o.position ?? '-'} → ${c.position}`,
             o.type !== c.type && `${c.code}: type ${o.type ?? '-'} → ${c.type}`,
             !o.in_source && `${c.code}: back in Liateam`].filter(Boolean).join(', '));
        await db.query(
          `INSERT INTO categories (code, name, parent_code, position, type, in_source) VALUES ($1,$2,$3,$4,$5,true)
           ON CONFLICT (code) DO UPDATE SET name = $2, parent_code = $3, position = $4, type = $5, in_source = true,
             updated_at = now()`,
          [c.code, c.name, c.parent_code, c.position, c.type],
        );
      }
      const listed = new Set(tree.map((c) => c.code));
      for (const o of before) {
        if (listed.has(o.code) || !o.in_source) continue;
        if (o.name) changes.push(`-${o.code} ${o.name} (no longer in Liateam)`);
        await db.query('UPDATE categories SET in_source = false, updated_at = now() WHERE code = $1', [o.code]);
      }
    } else {
      for (const c of named.values()) {
        await db.query(
          `INSERT INTO categories (code, name, parent_code) VALUES ($1,$2,$3)
           ON CONFLICT (code) DO UPDATE SET name = COALESCE(EXCLUDED.name, categories.name), updated_at = now()
           WHERE categories.name IS NULL AND EXCLUDED.name IS NOT NULL`,
          [c.code, c.name, c.parent_code],
        );
      }
    }
    for (const code of usedCodes) {
      await db.query('INSERT INTO categories (code, in_source) VALUES ($1, false) ON CONFLICT (code) DO NOTHING', [code]);
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  const { rows } = await db.query('SELECT count(*)::int AS n FROM categories');
  return { stored: rows[0].n, changes };
}

// Keys the dashboard may change, with validators. Anything else in the table is ignored.
export const SETTING_KEYS = {
  excludedCategories: (v) => Array.isArray(v) && v.every(Number.isInteger),
  sellableOverrides: (v) => Array.isArray(v) && v.every(Number.isInteger),
  priceJumpLimit: (v) => typeof v === 'number' && v > 0 && v <= 10,
  intervalHours: (v) => typeof v === 'number' && v >= 0.25 && v <= 168,
  telegramEnabled: (v) => typeof v === 'boolean',
  baleEnabled: (v) => typeof v === 'boolean',
  // Orders: true = every step runs except the final POST /order/orders (default until switched off).
  ordersDryRun: (v) => typeof v === 'boolean',
  // At or below this live stock an item is "limited" and its order is flagged urgent (never hidden).
  limitedStock: (v) => Number.isInteger(v) && v >= 0 && v <= 1000,
};

/** Connection pool for long-running processes (messenger); runs the schema once. */
export async function openPool() {
  const first = await openDb();
  await first.end();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
  pool.on('error', () => {}); // idle client errors are retried on next use
  return pool;
}

/** Overlays valid DB settings onto `config` (in place). Returns the keys that came from the DB. */
export async function applySettings(db, config) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const applied = [];
  for (const { key, value } of rows) {
    if (SETTING_KEYS[key]?.(value)) {
      config[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Stores the parsed hero slides (hero.mjs). Slides whose product / category is not in our catalog are skipped
 * (reason unknown-product / unknown-category). Rewritten only when the resulting slides changed (hash in
 * bot_status 'hero'). @returns {{ changed: boolean, slides: object[], skipped: object[] }}
 */
export async function saveHeroSlides(db, parsed, hashOf) {
  const { rows: products } = await db.query(
    'SELECT id FROM supplier_products WHERE missing_since IS NULL AND id = ANY ($1)',
    [parsed.slides.filter((s) => s.target_type === 'product').map((s) => s.target_code)]);
  const { rows: cats } = await db.query(
    'SELECT code FROM categories WHERE in_source AND code = ANY ($1)',
    [parsed.slides.filter((s) => s.target_type === 'category').map((s) => s.target_code)]);
  const known = { product: new Set(products.map((r) => r.id)), category: new Set(cats.map((r) => r.code)) };
  const slides = [];
  const skipped = [...parsed.skipped];
  for (const s of parsed.slides) {
    if (known[s.target_type].has(s.target_code)) slides.push(s);
    else skipped.push({ source_code: s.source_code, title: s.alt, link: `${s.target_type}/${s.target_code}`, reason: `unknown-${s.target_type}` });
  }
  const hash = hashOf(slides);
  const { rows: [prev] } = await db.query(`SELECT value FROM bot_status WHERE key = 'hero'`);
  const changed = prev?.value?.hash !== hash;
  if (changed) {
    await db.query('BEGIN');
    try {
      await db.query('DELETE FROM hero_slides');
      for (const [i, s] of slides.entries()) {
        await db.query(
          `INSERT INTO hero_slides (position, source_code, image_url, portrait_url, color, alt, target_type, target_code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [i, s.source_code, s.image_url, s.portrait_url, s.color, s.alt, s.target_type, s.target_code]);
      }
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  }
  const now = new Date().toISOString();
  await setStatus(db, 'hero', { hash, count: slides.length, skipped, checked_at: now,
    changed_at: changed ? now : (prev?.value?.changed_at ?? now) });
  return { changed, slides, skipped };
}

export async function setStatus(db, key, value) {
  await db.query(
    `INSERT INTO bot_status (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, JSON.stringify(value)],
  );
}

/**
 * Catalog changes between the stored state (`prev`, loaded before the upsert) and this run.
 * `accepted` = products written this run; `seenIds` = every product the source listed.
 * The very first run (empty table) produces no events, otherwise all 226 would be "new".
 */
export function diffCatalog(prev, accepted, seenIds) {
  const events = [];
  if (prev.size === 0) return events;
  const ev = (p, kind, o, n) => events.push({ product_id: p.id, name: p.name, kind, old_value: o == null ? null : String(o), new_value: n == null ? null : String(n) });
  for (const p of accepted) {
    const o = prev.get(p.id);
    if (!o) { ev(p, 'new', null, p.price); continue; }
    if (o.missing_since) ev(p, 'returned', null, null);
    if (Number(o.price) !== p.price) ev(p, 'price', o.price, p.price);
    if (Number(o.cost_price) !== p.cost_price) ev(p, 'cost', o.cost_price, p.cost_price);
    if (o.stock > 0 && p.stock <= 0) ev(p, 'out_of_stock', o.stock, p.stock);
    if (o.stock <= 0 && p.stock > 0) ev(p, 'back_in_stock', o.stock, p.stock);
    if (o.name !== p.name) ev(p, 'name', o.name, p.name);
  }
  for (const [id, o] of prev) {
    if (!seenIds.has(id) && !o.missing_since) ev({ id, name: o.name }, 'removed', null, null);
  }
  return events;
}

export async function recordEvents(db, events, removedIds) {
  for (const e of events) {
    await db.query('INSERT INTO product_events (product_id, name, kind, old_value, new_value) VALUES ($1,$2,$3,$4,$5)',
      [e.product_id, e.name, e.kind, e.old_value, e.new_value]);
  }
  if (removedIds.length) await db.query('UPDATE supplier_products SET missing_since = now() WHERE id = ANY($1) AND missing_since IS NULL', [removedIds]);
}
