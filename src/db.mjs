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
UPDATE sync_runs SET status = 'warning' WHERE status = 'partial';`;

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

export async function recordRun(db, run) {
  await db.query(
    `INSERT INTO sync_runs (started_at, status, fetched, written, sellable, rejected, duration_ms, failure_kind, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [run.startedAt, run.status, run.fetched, run.written, run.sellable, run.rejected, run.durationMs, run.failureKind, run.message],
  );
}
