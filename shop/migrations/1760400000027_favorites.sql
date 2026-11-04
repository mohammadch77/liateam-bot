-- Up Migration
-- The customer's list of favourite products (task K). The app role cannot DELETE, so taking a product out sets removed_at and putting
-- it back clears it (one row per user and product). No foreign key to the product: the catalog lives in the bot's schema.
CREATE TABLE favorites (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id INTEGER     NOT NULL, -- Liateam's product code (public.product_catalog.id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  UNIQUE (user_id, product_id)
);
CREATE INDEX favorites_user_live_idx ON favorites (user_id, created_at DESC) WHERE removed_at IS NULL;

-- Down Migration
DROP TABLE favorites;
