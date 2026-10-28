-- Up Migration
-- Checkout (the cart → «pending_payment» order):
--  * geo_provinces / geo_cities: Liateam's provinces and cities with Liateam's ids, filled on demand through the sync
--    bot's «geo» job (the shop cannot call Liateam) and refreshed after a week; the address form reads them here.
--  * carts.review_id: the live price / stock check (bot «review» job) the cart is currently waiting on or holding, so a new
--    check releases the previous hold and an order can only be made from the cart's own check.
--  * orders.delivery_eta_min_days / _max_days: the delivery window the customer was shown (the shop's own range for the
--    method and province, plus the admin's extra days).
--  * shipping_methods gets its «post» row (label only: the delivery range is entered by the client) and the setting
--    shipping.extra_days (1).
-- Additive; nothing existing changes.
CREATE TABLE geo_provinces (
  id         INTEGER     PRIMARY KEY CONSTRAINT geo_provinces_id_positive CHECK (id > 0), -- Liateam's province id
  name       TEXT        NOT NULL CONSTRAINT geo_provinces_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE geo_cities (
  id          INTEGER     PRIMARY KEY CONSTRAINT geo_cities_id_positive CHECK (id > 0), -- Liateam's city id
  province_id INTEGER     NOT NULL REFERENCES geo_provinces (id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CONSTRAINT geo_cities_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX geo_cities_province_idx ON geo_cities (province_id, name);

ALTER TABLE carts ADD COLUMN review_id INTEGER; -- public.order_jobs.id of the cart's live check (no foreign key across schemas)

ALTER TABLE orders
  ADD COLUMN delivery_eta_min_days SMALLINT CONSTRAINT orders_eta_min_nonneg CHECK (delivery_eta_min_days >= 0),
  ADD COLUMN delivery_eta_max_days SMALLINT,
  ADD CONSTRAINT orders_eta_order CHECK (delivery_eta_max_days IS NULL OR delivery_eta_min_days IS NULL OR delivery_eta_max_days >= delivery_eta_min_days);

INSERT INTO shipping_methods (code, label, sort_order) VALUES ('post', 'پست', 1) ON CONFLICT (code) DO NOTHING;
INSERT INTO site_settings (key, value) VALUES ('shipping.extra_days', '1') ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM site_settings WHERE key = 'shipping.extra_days';
DELETE FROM shipping_methods WHERE code = 'post' AND NOT EXISTS (SELECT 1 FROM shipping_rules r WHERE r.method_id = shipping_methods.id);
ALTER TABLE orders DROP CONSTRAINT orders_eta_order, DROP COLUMN delivery_eta_max_days, DROP COLUMN delivery_eta_min_days;
ALTER TABLE carts DROP COLUMN review_id;
DROP TABLE geo_cities;
DROP TABLE geo_provinces;
