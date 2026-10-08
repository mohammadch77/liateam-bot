import pg from 'pg';
import { config } from './config.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS supplier_products (
  id            INTEGER PRIMARY KEY,          -- supplier code
  uuid          UUID,
  name          TEXT    NOT NULL,
  price         BIGINT  NOT NULL,             -- selling price, RIAL
  cost_price    BIGINT  NOT NULL,             -- payable_price, RIAL, internal only
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
-- Product + category names; unnamed/unknown categories show as their code (never an error).
DROP VIEW IF EXISTS product_catalog;
CREATE VIEW product_catalog AS
SELECT p.*,
       COALESCE((SELECT array_agg(COALESCE(c.name, '#' || x.code) ORDER BY x.ord)
                   FROM unnest(p.category) WITH ORDINALITY AS x(code, ord)
                   LEFT JOIN categories c ON c.code = x.code), '{}') AS category_names
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
-- Non-secret health facts written by the bot (session expiry, telegram configured, worker heartbeat).
CREATE TABLE IF NOT EXISTS bot_status (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

export async function openDb() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  await client.query(SCHEMA);
  return client;
}

export async function loadPrevious(db) {
  const { rows } = await db.query('SELECT id, price, cost_price, stock FROM supplier_products');
  return new Map(rows.map((r) => [r.id, r]));
}

export async function upsertProducts(db, products) {
  await db.query('BEGIN');
  try {
    for (const p of products) {
      const { rows } = await db.query(
        `INSERT INTO supplier_products (id, uuid, name, price, cost_price, stock, category, is_available, is_sellable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           uuid=EXCLUDED.uuid, name=EXCLUDED.name, price=EXCLUDED.price, cost_price=EXCLUDED.cost_price,
           stock=EXCLUDED.stock, category=EXCLUDED.category, is_available=EXCLUDED.is_available, is_sellable=EXCLUDED.is_sellable,
           last_seen_at=now(),
           updated_at = CASE WHEN (supplier_products.price, supplier_products.cost_price, supplier_products.stock)
                                IS DISTINCT FROM (EXCLUDED.price, EXCLUDED.cost_price, EXCLUDED.stock)
                             THEN now() ELSE supplier_products.updated_at END
         RETURNING (xmax = 0) AS inserted, updated_at = now() AS changed`,
        [p.id, p.uuid, p.name, p.price, p.cost_price, p.stock, p.category, p.is_available, p.is_sellable],
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
 * Stores named categories, plus a nameless row for every code used by a product so the join is total.
 * A name already known is never overwritten with NULL (a page that omits the tree must not erase it).
 */
export async function upsertCategories(db, named, usedCodes) {
  const all = new Map([...usedCodes].map((code) => [code, { code, name: null, parent_code: null }]));
  for (const [code, c] of named) all.set(code, c);
  for (const c of all.values()) {
    await db.query(
      `INSERT INTO categories (code, name, parent_code) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, categories.name),
         parent_code = COALESCE(EXCLUDED.parent_code, categories.parent_code),
         updated_at = CASE WHEN EXCLUDED.name IS NOT NULL THEN now() ELSE categories.updated_at END`,
      [c.code, c.name, c.parent_code],
    );
  }
  return all.size;
}

// Keys the dashboard may change, with validators. Anything else in the table is ignored.
export const SETTING_KEYS = {
  excludedCategories: (v) => Array.isArray(v) && v.every(Number.isInteger),
  sellableOverrides: (v) => Array.isArray(v) && v.every(Number.isInteger),
  priceJumpLimit: (v) => typeof v === 'number' && v > 0 && v <= 10,
  intervalHours: (v) => typeof v === 'number' && v >= 0.5 && v <= 168,
};

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

export async function setStatus(db, key, value) {
  await db.query(
    `INSERT INTO bot_status (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, JSON.stringify(value)],
  );
}
