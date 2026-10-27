-- Up Migration
-- Affiliate: a referral code per affiliate, who referred which buyer, the commission rules and the commissions of orders.
-- commission_rules is created EMPTY on purpose: no percentage or amount is decided here (the client sets them); with no
-- active rule no commission is created. Commission: pending (order not finished) → approved → paid, or cancelled.
CREATE TYPE commission_status AS ENUM ('pending', 'approved', 'paid', 'cancelled');

CREATE TABLE affiliate_codes (
  user_id    BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code       TEXT        NOT NULL UNIQUE CONSTRAINT affiliate_codes_format CHECK (code ~ '^[a-z0-9]{4,20}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A buyer has one referrer, fixed at the first referred sign-up.
CREATE TABLE affiliate_referrals (
  buyer_user_id    BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  referrer_user_id BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  code             TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT affiliate_referrals_not_self CHECK (buyer_user_id <> referrer_user_id)
);
CREATE INDEX affiliate_referrals_referrer_idx ON affiliate_referrals (referrer_user_id);

CREATE TABLE commission_rules (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT          NOT NULL CONSTRAINT commission_rules_name_length CHECK (char_length(name) BETWEEN 2 AND 80),
  kind            TEXT          NOT NULL CONSTRAINT commission_rules_kind CHECK (kind IN ('percent', 'fixed')),
  value           NUMERIC(12, 4) NOT NULL CONSTRAINT commission_rules_value_positive CHECK (value > 0), -- percent of the goods total, or TOMAN per order
  min_order_total BIGINT        NOT NULL DEFAULT 0 CONSTRAINT commission_rules_min_nonneg CHECK (min_order_total >= 0),
  valid_from      TIMESTAMPTZ,
  valid_to        TIMESTAMPTZ,
  active          BOOLEAN       NOT NULL DEFAULT true,
  created_by      BIGINT        REFERENCES users (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT commission_rules_percent_range CHECK (kind <> 'percent' OR value <= 100),
  CONSTRAINT commission_rules_window CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);

CREATE TABLE commissions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          BIGINT            NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  affiliate_user_id BIGINT            NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  rule_id           BIGINT            REFERENCES commission_rules (id) ON DELETE SET NULL,
  base_amount       BIGINT            NOT NULL CONSTRAINT commissions_base_nonneg CHECK (base_amount >= 0), -- the goods total it was computed on
  amount            BIGINT            NOT NULL CONSTRAINT commissions_amount_nonneg CHECK (amount >= 0),
  status            commission_status NOT NULL DEFAULT 'pending',
  wallet_entry_id   BIGINT            REFERENCES wallet_ledger (id) ON DELETE SET NULL, -- the payout, when paid into the wallet
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  UNIQUE (order_id, affiliate_user_id),
  CONSTRAINT commissions_paid_has_time CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);
CREATE INDEX commissions_affiliate_idx ON commissions (affiliate_user_id, status);

CREATE FUNCTION commissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.affiliate_user_id IS DISTINCT FROM OLD.affiliate_user_id
     OR NEW.base_amount IS DISTINCT FROM OLD.base_amount OR NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'a commission''s order and amount cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending'  AND NEW.status IN ('approved', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'cancelled'))) THEN
    RAISE EXCEPTION 'commission status % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commissions_guard BEFORE UPDATE ON commissions FOR EACH ROW EXECUTE FUNCTION commissions_guard();

-- Down Migration
DROP TABLE commissions;
DROP FUNCTION commissions_guard();
DROP TABLE commission_rules;
DROP TABLE affiliate_referrals;
DROP TABLE affiliate_codes;
DROP TYPE commission_status;
