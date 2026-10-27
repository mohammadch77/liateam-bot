-- Up Migration
-- Shopping cart: a guest cart is found by the hash of a cookie token (the token itself is never stored), a signed-in
-- user's cart by user_id. After sign-in the guest cart is merged into the user's (status 'merged', merged_into_id keeps
-- the trail). A cart holds NO prices: they are always computed from the database's price function when shown.
-- The app never deletes rows: an item taken out is set to quantity 0 and is simply not listed.
CREATE TYPE cart_status AS ENUM ('open', 'merged', 'ordered', 'abandoned');

CREATE TABLE carts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          BIGINT      REFERENCES users (id) ON DELETE CASCADE,
  guest_token_hash TEXT        CONSTRAINT carts_guest_token_hash_length CHECK (char_length(guest_token_hash) >= 32),
  status           cart_status NOT NULL DEFAULT 'open',
  merged_into_id   BIGINT      REFERENCES carts (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- a cart belongs to a user or to a guest token, never both and never neither
  CONSTRAINT carts_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL)),
  CONSTRAINT carts_merged_target CHECK ((status = 'merged') = (merged_into_id IS NOT NULL))
);
CREATE UNIQUE INDEX carts_one_open_per_user ON carts (user_id) WHERE status = 'open' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX carts_guest_token_key ON carts (guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE INDEX carts_merged_into_idx ON carts (merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  cart_id    BIGINT      NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id INTEGER     NOT NULL, -- Liateam's product code (public.product_catalog.id); no foreign key across schemas
  quantity   INTEGER     NOT NULL CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 0 AND 50), -- 0 = taken out
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, product_id)
);
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE cart_items;
DROP TABLE carts;
DROP TYPE cart_status;
