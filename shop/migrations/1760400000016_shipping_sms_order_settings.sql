-- Up Migration
-- Shipping methods and rules (labels and timing only: the PRICE of shipping is always Liateam's, taken from the live
-- check), the SMS log (who was texted, why, and whether it was sent — never the text or a code), and the settings of
-- the order flow with their starting values (site_settings, key → JSON; the admin screen comes later).
CREATE TABLE shipping_methods (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         TEXT        NOT NULL UNIQUE CONSTRAINT shipping_methods_code_format CHECK (code ~ '^[a-z0-9_]{2,30}$'),
  label        TEXT        NOT NULL CONSTRAINT shipping_methods_label_length CHECK (char_length(label) BETWEEN 2 AND 80),
  eta_min_days SMALLINT    CONSTRAINT shipping_methods_eta_min CHECK (eta_min_days >= 0),
  eta_max_days SMALLINT,
  active       BOOLEAN     NOT NULL DEFAULT true,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_methods_eta_order CHECK (eta_max_days IS NULL OR eta_min_days IS NULL OR eta_max_days >= eta_min_days)
);

-- A method's delivery time for one province (province_id = Liateam's id; null = every province).
CREATE TABLE shipping_rules (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  method_id    BIGINT      NOT NULL REFERENCES shipping_methods (id) ON DELETE CASCADE,
  province_id  INTEGER     CONSTRAINT shipping_rules_province_positive CHECK (province_id > 0),
  eta_min_days SMALLINT    NOT NULL CONSTRAINT shipping_rules_eta_min CHECK (eta_min_days >= 0),
  eta_max_days SMALLINT    NOT NULL,
  note         TEXT        CONSTRAINT shipping_rules_note_length CHECK (char_length(note) <= 200),
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_rules_eta_order CHECK (eta_max_days >= eta_min_days)
);
CREATE UNIQUE INDEX shipping_rules_method_province_key ON shipping_rules (method_id, coalesce(province_id, 0));

CREATE TABLE sms_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  phone        TEXT        NOT NULL CONSTRAINT sms_log_phone_format CHECK (phone ~ '^09\d{9}$'),
  purpose      TEXT        NOT NULL CONSTRAINT sms_log_purpose CHECK (purpose IN ('otp', 'order', 'shipping', 'other')),
  provider     TEXT        NOT NULL CONSTRAINT sms_log_provider_length CHECK (char_length(provider) <= 30),
  status       TEXT        NOT NULL DEFAULT 'queued' CONSTRAINT sms_log_status CHECK (status IN ('queued', 'sent', 'failed')),
  provider_ref TEXT        CONSTRAINT sms_log_provider_ref_length CHECK (char_length(provider_ref) <= 80),
  error        TEXT        CONSTRAINT sms_log_error_length CHECK (char_length(error) <= 200),
  order_id     BIGINT      REFERENCES orders (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sms_log_phone_idx ON sms_log (phone, created_at DESC);

-- Order-flow settings. Starting values only; nothing reads them until the order flow exists.
--   orders.price_tolerance_toman  a live Liateam total that moved more than this stops an order (needs_review); the bot has its own default, 10
--   orders.auto_place_enabled     the master switch of automatic placing at Liateam; OFF: orders wait in the queue for the operator's button
--   orders.auto_place_hours       working hours (Asia/Tehran) in which a paid order is placed at once; outside them it waits and is re-checked in the morning
--   shipping.free_enabled         free shipping above a goods total: OFF
--   shipping.free_from_toman      the threshold (goods total, after discounts, from this amount the customer pays no shipping; the shop absorbs Liateam's price)
INSERT INTO site_settings (key, value) VALUES
  ('orders.price_tolerance_toman', '10'),
  ('orders.auto_place_enabled', 'false'),
  ('orders.auto_place_hours', '{"from": "09:00", "to": "21:00"}'),
  ('shipping.free_enabled', 'false'),
  ('shipping.free_from_toman', '999000')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM site_settings WHERE key IN
  ('orders.price_tolerance_toman', 'orders.auto_place_enabled', 'orders.auto_place_hours', 'shipping.free_enabled', 'shipping.free_from_toman');
DROP TABLE sms_log;
DROP TABLE shipping_rules;
DROP TABLE shipping_methods;
