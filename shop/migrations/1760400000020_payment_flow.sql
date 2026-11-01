-- Up Migration
-- Payment flow (step D).
-- 1. An order may change its payment method (gateway <-> wallet) while it is still pending_payment: a customer who failed at the
--    gateway can pay from the wallet instead. After the first payment the method stays fixed as before. Only orders_guard()
--    changes; the amounts and the address stay untouchable.
-- 2. Commissions remember the hold they were created with and, once the order is sent, the day they can be approved.
CREATE OR REPLACE FUNCTION orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT order_status_can_move(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'order status % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- what the customer agreed to never changes afterwards (the payment method only before the first payment)
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR (NEW.payment_method IS DISTINCT FROM OLD.payment_method AND OLD.status <> 'pending_payment')
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

ALTER TABLE commissions
  ADD COLUMN hold_days  SMALLINT    NOT NULL DEFAULT 0 CONSTRAINT commissions_hold_range CHECK (hold_days BETWEEN 0 AND 365),
  ADD COLUMN release_at TIMESTAMPTZ; -- set when the order is sent: sent_at + hold_days; before that a commission cannot be approved

-- Down Migration
ALTER TABLE commissions DROP COLUMN release_at, DROP COLUMN hold_days;
CREATE OR REPLACE FUNCTION orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT order_status_can_move(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'order status % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
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
  IF OLD.bot_order_id IS NOT NULL AND NEW.bot_order_id IS DISTINCT FROM OLD.bot_order_id THEN
    RAISE EXCEPTION 'the bot order of an order cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
