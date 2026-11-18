-- Up Migration
-- Pack Bundles in Shopping Cart:
-- When a practical pack is added to the cart, it is tracked as a bundle in cart_packs,
-- rather than decomposed into individual products.
CREATE TABLE cart_packs (
  cart_id    BIGINT      NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  pack_id    BIGINT      NOT NULL REFERENCES packs (id) ON DELETE CASCADE,
  quantity   INTEGER     NOT NULL CONSTRAINT cart_packs_quantity_range CHECK (quantity BETWEEN 0 AND 50),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, pack_id)
);
CREATE TRIGGER cart_packs_set_updated_at BEFORE UPDATE ON cart_packs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE cart_packs;
