-- Up Migration
-- Packs: a few products sold together for less («روتین پوستی»: one pack per skin type, five steps). General on
-- purpose: a collection (skin-routine, later e.g. perfume sets) has variants (oily / dry …), each variant is a pack
-- of ordered steps. The pack's price is computed per request from the items' current prices (public.shop_pack_price,
-- deploy/…-010-pack-prices.sql); nothing price-related is stored here except the pack's own discount.
CREATE TABLE pack_collections (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT        NOT NULL UNIQUE CONSTRAINT pack_collection_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  title         TEXT        NOT NULL CONSTRAINT pack_collection_title_length CHECK (char_length(title) BETWEEN 2 AND 80),
  -- what the variants are called («نوع پوست»)
  variant_label TEXT        NOT NULL CONSTRAINT pack_collection_variant_label_length CHECK (char_length(variant_label) BETWEEN 2 AND 40),
  active        BOOLEAN     NOT NULL DEFAULT true,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE packs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection_id  BIGINT      NOT NULL REFERENCES pack_collections (id) ON DELETE CASCADE,
  -- the English address part (/packs/skin-routine/oily) and its Persian name («پوست چرب»)
  variant_key    TEXT        NOT NULL CONSTRAINT pack_variant_key CHECK (variant_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(variant_key) <= 40),
  variant_title  TEXT        NOT NULL CONSTRAINT pack_variant_title_length CHECK (char_length(variant_title) BETWEEN 2 AND 40),
  title          TEXT        NOT NULL CONSTRAINT pack_title_length CHECK (char_length(title) BETWEEN 3 AND 100),
  description    TEXT        NOT NULL DEFAULT '' CONSTRAINT pack_description_length CHECK (char_length(description) <= 600),
  -- percent: 1–90 off the items' total · fixed_price: the pack's price in toman
  discount_kind  TEXT        NOT NULL CONSTRAINT pack_discount_kind CHECK (discount_kind IN ('percent', 'fixed_price')),
  discount_value BIGINT      NOT NULL,
  active         BOOLEAN     NOT NULL DEFAULT true,
  -- the admin's explicit decision: this pack may sell under the items' purchase prices
  allow_loss     BOOLEAN     NOT NULL DEFAULT false,
  starts_at      TIMESTAMPTZ,
  ends_at        TIMESTAMPTZ,
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_by     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, variant_key),
  CONSTRAINT pack_discount_value CHECK (
    (discount_kind = 'percent' AND discount_value BETWEEN 1 AND 90)
    OR (discount_kind = 'fixed_price' AND discount_value BETWEEN 1000 AND 10000000000)),
  CONSTRAINT pack_period CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE pack_items (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pack_id    BIGINT  NOT NULL REFERENCES packs (id) ON DELETE CASCADE,
  step_label TEXT    NOT NULL CONSTRAINT pack_item_step_length CHECK (char_length(step_label) BETWEEN 2 AND 40),
  -- a supplier product id; NULL = no suitable product yet («به‌زودی»)
  product_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- the app never deletes rows: a step removed in the panel is switched off (its slot is reused on the next save)
  enabled    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (pack_id, sort_order)
);
CREATE INDEX packs_collection_idx ON packs (collection_id, sort_order);

-- Down Migration
DROP TABLE pack_items;
DROP TABLE packs;
DROP TABLE pack_collections;
