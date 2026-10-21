-- Up Migration
-- Our own discounts and campaigns (admin panel). The sync bot never touches these tables; Liateam's price stays as
-- synced and the discounted price is computed per request (public.shop_offer_prices, deploy/…-009-offer-prices.sql),
-- so a new Liateam price is discounted automatically. No purchase price or Liateam discount is stored here.
CREATE TABLE campaigns (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       TEXT        NOT NULL CONSTRAINT campaign_title_length CHECK (char_length(title) BETWEEN 3 AND 80),
  -- the bar above the header while the campaign runs
  banner_text TEXT        NOT NULL CONSTRAINT campaign_banner_length CHECK (char_length(banner_text) BETWEEN 3 AND 120),
  ends_at     TIMESTAMPTZ NOT NULL,
  -- a same-site path (the offers page by default)
  link        TEXT        NOT NULL DEFAULT '/offers'
              CONSTRAINT campaign_link_path CHECK (link ~ '^/[A-Za-z0-9/_?=&%.-]*$' AND char_length(link) <= 200),
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_by  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shop_discounts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope       TEXT        NOT NULL CONSTRAINT discount_scope CHECK (scope IN ('product', 'category', 'brand', 'all')),
  -- product id / category code / brand code; none for the whole shop
  target_code INTEGER,
  kind        TEXT        NOT NULL CONSTRAINT discount_kind CHECK (kind IN ('percent', 'amount')),
  -- percent: 1–90 · amount: toman
  value       BIGINT      NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at     TIMESTAMPTZ,
  label       TEXT        CONSTRAINT discount_label_length CHECK (char_length(label) <= 60),
  campaign_id BIGINT      REFERENCES campaigns (id) ON DELETE SET NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_by  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discount_target CHECK ((scope = 'all') = (target_code IS NULL)),
  CONSTRAINT discount_value CHECK (
    (kind = 'percent' AND value BETWEEN 1 AND 90) OR (kind = 'amount' AND value BETWEEN 1000 AND 1000000000)),
  CONSTRAINT discount_period CHECK (ends_at IS NULL OR ends_at > starts_at)
);
-- the running ones (read every ~30 s by the shop)
CREATE INDEX shop_discounts_live_idx ON shop_discounts (ends_at) WHERE active;
CREATE INDEX campaigns_live_idx ON campaigns (ends_at) WHERE active;

-- Down Migration
DROP TABLE shop_discounts;
DROP TABLE campaigns;
