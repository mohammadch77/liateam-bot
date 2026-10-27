-- Up Migration
-- The shop's orders. The customer pays the shop's price; the sync bot places the order at Liateam at the supplier's price
-- (public.shop_orders, one to one through bot_order_id — no foreign key across schemas). Nothing here knows or stores a
-- purchase price or a profit: order_items keep what the customer was charged and what Liateam's list price was.
--
-- Status: pending_payment (checkout done, the customer has not paid) → queued (paid, waiting for the bot) → placing →
-- awaiting_payment (placed at Liateam, an operator pays) → supplier_paid → sent; plus needs_review (a live price or
-- stock check stopped the placing), refunded and canceled. The bot's own statuses are mirrored, and it may move between
-- them quicker than the shop polls, so a forward step may skip one (order_status_can_move below; the same table is in
-- src/lib/orders/status.ts and a test compares the two).
CREATE TYPE order_status AS ENUM (
  'pending_payment', 'queued', 'placing', 'awaiting_payment', 'supplier_paid', 'sent', 'needs_review', 'refunded', 'canceled'
);
CREATE TYPE payment_status AS ENUM ('initiated', 'confirmed', 'failed');

CREATE FUNCTION order_status_can_move(from_status order_status, to_status order_status) RETURNS boolean
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE from_status
    WHEN 'pending_payment'  THEN to_status IN ('queued', 'canceled')
    WHEN 'queued'           THEN to_status IN ('placing', 'awaiting_payment', 'needs_review', 'refunded', 'canceled')
    WHEN 'placing'          THEN to_status IN ('queued', 'awaiting_payment', 'needs_review', 'refunded', 'canceled')
    WHEN 'needs_review'     THEN to_status IN ('queued', 'placing', 'awaiting_payment', 'refunded', 'canceled')
    WHEN 'awaiting_payment' THEN to_status IN ('queued', 'supplier_paid', 'sent', 'canceled')
    WHEN 'supplier_paid'    THEN to_status IN ('sent', 'canceled')
    ELSE false -- sent, refunded, canceled are final
  END
$$;

-- Rows of the tables below that must never change (or only in some columns) are guarded by triggers: the app role may
-- UPDATE (it has no DELETE at all), so the database itself keeps the history honest.
CREATE FUNCTION append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE SEQUENCE order_number_seq START 100001;

CREATE TABLE orders (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number                  TEXT         NOT NULL UNIQUE DEFAULT ('AV-' || nextval('order_number_seq')), -- readable: AV-100001
  user_id                 BIGINT       NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  idempotency_key         TEXT         NOT NULL UNIQUE CONSTRAINT orders_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 16 AND 100),
  status                  order_status NOT NULL DEFAULT 'pending_payment',
  payment_method          TEXT         NOT NULL CONSTRAINT orders_payment_method CHECK (payment_method IN ('gateway', 'wallet')),
  -- delivery address as it was at checkout (a snapshot: the address book may change later)
  recipient_name          TEXT         NOT NULL CONSTRAINT orders_recipient_name_length CHECK (char_length(recipient_name) BETWEEN 2 AND 120),
  recipient_phone         TEXT         NOT NULL CONSTRAINT orders_recipient_phone_format CHECK (recipient_phone ~ '^09\d{9}$'),
  province                TEXT         NOT NULL,
  city                    TEXT         NOT NULL,
  province_id             INTEGER      NOT NULL CONSTRAINT orders_province_id_positive CHECK (province_id > 0),
  city_id                 INTEGER      NOT NULL CONSTRAINT orders_city_id_positive CHECK (city_id > 0),
  postal_code             TEXT         NOT NULL CONSTRAINT orders_postal_code_format CHECK (postal_code ~ '^\d{10}$'),
  line                    TEXT         NOT NULL CONSTRAINT orders_line_length CHECK (char_length(line) BETWEEN 5 AND 400),
  plate                   TEXT         NOT NULL,
  unit                    TEXT,
  -- money: TOMAN, bigint
  items_total             BIGINT       NOT NULL CONSTRAINT orders_items_total_nonneg CHECK (items_total >= 0),     -- what the customer is charged for goods
  discount_total          BIGINT       NOT NULL DEFAULT 0 CONSTRAINT orders_discount_total_nonneg CHECK (discount_total >= 0), -- list price minus charged (information)
  shipping_supplier_price BIGINT       NOT NULL CONSTRAINT orders_shipping_supplier_nonneg CHECK (shipping_supplier_price >= 0), -- Liateam's real price
  shipping_charged        BIGINT       NOT NULL CONSTRAINT orders_shipping_charged_nonneg CHECK (shipping_charged >= 0),         -- what the customer pays (0 above the free-shipping threshold)
  shipping_absorbed       BIGINT       GENERATED ALWAYS AS (shipping_supplier_price - shipping_charged) STORED,                  -- what the shop pays for the customer
  total_payable           BIGINT       GENERATED ALWAYS AS (items_total + shipping_charged) STORED,
  refunded_total          BIGINT       NOT NULL DEFAULT 0 CONSTRAINT orders_refunded_nonneg CHECK (refunded_total >= 0),
  -- the live check against Liateam at checkout (the bot's «review»): when, whether the basket can be placed, Liateam's goods + shipping total
  review_id               INTEGER,
  live_checked_at         TIMESTAMPTZ,
  live_ok                 BOOLEAN,
  live_total              BIGINT       CONSTRAINT orders_live_total_nonneg CHECK (live_total >= 0),
  live_expires_at         TIMESTAMPTZ,
  -- the link to the bot's order (public.shop_orders.id)
  bot_order_id            INTEGER      UNIQUE,
  needs_review_reason     TEXT         CONSTRAINT orders_needs_review_reason_length CHECK (char_length(needs_review_reason) <= 300),
  tracking                JSONB,
  referrer_user_id        BIGINT       REFERENCES users (id) ON DELETE SET NULL,
  paid_at                 TIMESTAMPTZ,
  placed_at               TIMESTAMPTZ,
  supplier_paid_at        TIMESTAMPTZ,
  sent_at                 TIMESTAMPTZ,
  canceled_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT orders_shipping_charged_le_supplier CHECK (shipping_charged <= shipping_supplier_price),
  CONSTRAINT orders_refund_le_paid CHECK (refunded_total <= items_total + shipping_charged),
  CONSTRAINT orders_live_check_complete CHECK ((live_checked_at IS NULL) = (live_ok IS NULL)),
  -- past «pending_payment» (or canceled before paying) an order has been paid
  CONSTRAINT orders_paid_before_queue CHECK (status IN ('pending_payment', 'canceled') OR paid_at IS NOT NULL)
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at) WHERE status NOT IN ('sent', 'refunded', 'canceled');
CREATE INDEX orders_referrer_idx ON orders (referrer_user_id) WHERE referrer_user_id IS NOT NULL;

CREATE FUNCTION orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT order_status_can_move(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'order status % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- what the customer agreed to never changes afterwards
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.items_total IS DISTINCT FROM OLD.items_total OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
     OR NEW.shipping_supplier_price IS DISTINCT FROM OLD.shipping_supplier_price
     OR NEW.shipping_charged IS DISTINCT FROM OLD.shipping_charged
     OR NEW.province_id IS DISTINCT FROM OLD.province_id OR NEW.city_id IS DISTINCT FROM OLD.city_id
     OR NEW.postal_code IS DISTINCT FROM OLD.postal_code OR NEW.line IS DISTINCT FROM OLD.line THEN
    RAISE EXCEPTION 'the amounts and the address of an order cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.refunded_total < OLD.refunded_total THEN
    RAISE EXCEPTION 'a refund cannot be taken back' USING ERRCODE = 'check_violation';
  END IF;
  -- the bot's order is linked once
  IF OLD.bot_order_id IS NOT NULL AND NEW.bot_order_id IS DISTINCT FROM OLD.bot_order_id THEN
    RAISE EXCEPTION 'the bot order of an order cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER orders_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_guard();

CREATE TABLE order_items (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          BIGINT        NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  product_id        INTEGER       NOT NULL, -- Liateam's product code
  name              TEXT          NOT NULL CONSTRAINT order_items_name_length CHECK (char_length(name) BETWEEN 1 AND 300),
  quantity          INTEGER       NOT NULL CONSTRAINT order_items_quantity_range CHECK (quantity BETWEEN 1 AND 50),
  -- the snapshot: Liateam's list price, what the customer was charged per unit, and which discount did it
  unit_list_price   BIGINT        NOT NULL CONSTRAINT order_items_list_price_nonneg CHECK (unit_list_price >= 0),
  unit_price        BIGINT        NOT NULL CONSTRAINT order_items_unit_price_nonneg CHECK (unit_price >= 0),
  discount_percent  NUMERIC(5, 2) NOT NULL DEFAULT 0 CONSTRAINT order_items_discount_range CHECK (discount_percent BETWEEN 0 AND 100),
  discount_label    TEXT          CONSTRAINT order_items_discount_label_length CHECK (char_length(discount_label) <= 80),
  pricing_mode      TEXT          CONSTRAINT order_items_pricing_mode CHECK (pricing_mode IN ('partner', 'consumer', 'beyond_base')),
  line_total        BIGINT        GENERATED ALWAYS AS (unit_price * quantity) STORED,
  -- mirrored from the bot (public.shop_order_items.status): ok | refunded (not available when placing)
  bot_status        TEXT          NOT NULL DEFAULT 'ok' CONSTRAINT order_items_bot_status CHECK (bot_status IN ('ok', 'refunded')),
  -- what the shop refunded to the customer for this line, from its own snapshot (never from the bot's prices)
  refunded_quantity INTEGER       NOT NULL DEFAULT 0,
  refunded_amount   BIGINT        NOT NULL DEFAULT 0 CONSTRAINT order_items_refunded_amount_nonneg CHECK (refunded_amount >= 0),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT order_items_price_le_list CHECK (unit_price <= unit_list_price),
  CONSTRAINT order_items_refund_le_line CHECK (refunded_quantity BETWEEN 0 AND quantity AND refunded_amount <= unit_price * quantity),
  UNIQUE (order_id, product_id)
);

CREATE FUNCTION order_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.unit_list_price IS DISTINCT FROM OLD.unit_list_price OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent OR NEW.discount_label IS DISTINCT FROM OLD.discount_label
     OR NEW.pricing_mode IS DISTINCT FROM OLD.pricing_mode THEN
    RAISE EXCEPTION 'the price snapshot of an order line cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.bot_status = 'refunded' AND NEW.bot_status IS DISTINCT FROM OLD.bot_status THEN
    RAISE EXCEPTION 'a refunded line stays refunded' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_items_guard BEFORE UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION order_items_guard();

-- What happened to an order (customer-visible timeline and the operator's trail). Append-only.
CREATE TABLE order_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      BIGINT      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  kind          TEXT        NOT NULL CONSTRAINT order_events_kind_format CHECK (kind ~ '^[a-z_]{2,40}$'),
  actor_user_id BIGINT      REFERENCES users (id) ON DELETE SET NULL, -- null = the system
  data          JSONB,      -- never a purchase price or a profit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON order_events FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- The customer's payment to the shop. One order is confirmed once: the unique index below, not application code,
-- refuses a second confirmation (a gateway callback that arrives twice).
CREATE TABLE payments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        BIGINT         NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  method          TEXT           NOT NULL CONSTRAINT payments_method CHECK (method IN ('gateway', 'wallet')),
  gateway         TEXT           CONSTRAINT payments_gateway_length CHECK (char_length(gateway) <= 40),
  amount          BIGINT         NOT NULL CONSTRAINT payments_amount_positive CHECK (amount > 0),
  status          payment_status NOT NULL DEFAULT 'initiated',
  gateway_ref     TEXT           CONSTRAINT payments_gateway_ref_length CHECK (char_length(gateway_ref) <= 120),
  idempotency_key TEXT           NOT NULL UNIQUE CONSTRAINT payments_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 16 AND 100),
  failure_reason  TEXT           CONSTRAINT payments_failure_reason_length CHECK (char_length(failure_reason) <= 200),
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  CONSTRAINT payments_confirmed_has_time CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX payments_one_confirmed_per_order ON payments (order_id) WHERE status = 'confirmed';
CREATE UNIQUE INDEX payments_gateway_ref_key ON payments (gateway, gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX payments_order_idx ON payments (order_id, created_at);

CREATE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'a payment''s order, method and amount cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'initiated' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'payment is already % and cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Down Migration
DROP TABLE payments;
DROP FUNCTION payments_guard();
DROP TABLE order_events;
DROP TABLE order_items;
DROP FUNCTION order_items_guard();
DROP TABLE orders;
DROP FUNCTION orders_guard();
DROP SEQUENCE order_number_seq;
DROP FUNCTION append_only_guard();
DROP FUNCTION order_status_can_move(order_status, order_status);
DROP TYPE payment_status;
DROP TYPE order_status;
