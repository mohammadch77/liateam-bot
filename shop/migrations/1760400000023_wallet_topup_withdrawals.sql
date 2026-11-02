-- Up Migration
-- Wallet top-up and withdrawals (task F).
-- 1. The ledger's sign rule knows the new kind: withdrawal_return is money in.
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_sign;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_sign CHECK (
  (kind IN ('topup', 'refund', 'commission', 'withdrawal_return') AND amount > 0)
  OR (kind IN ('order_payment', 'withdrawal') AND amount < 0)
);

-- 2. A payment attempt is either for an order (as before) or a wallet top-up of a user. The same table, the same guards (a confirmed
--    payment is final, its amount cannot change, one gateway reference once), so the callback and the verification are shared.
ALTER TABLE payments
  ADD COLUMN kind    TEXT   NOT NULL DEFAULT 'order' CONSTRAINT payments_kind CHECK (kind IN ('order', 'wallet_topup')),
  ADD COLUMN user_id BIGINT REFERENCES users (id) ON DELETE RESTRICT;
ALTER TABLE payments ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_kind_link CHECK (
  (kind = 'order' AND order_id IS NOT NULL) OR (kind = 'wallet_topup' AND order_id IS NULL AND user_id IS NOT NULL AND method = 'gateway')
);
CREATE INDEX payments_user_topup_idx ON payments (user_id, created_at) WHERE kind = 'wallet_topup';

-- 3. Withdrawals: money held at the request, paid by hand by an operator (status paid + the bank's tracking code), or returned.
CREATE TYPE withdrawal_status AS ENUM ('pending', 'paid', 'rejected', 'canceled');
CREATE TABLE withdrawals (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          BIGINT            NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount           BIGINT            NOT NULL CONSTRAINT withdrawals_amount_positive CHECK (amount > 0), -- TOMAN
  iban             TEXT              NOT NULL CONSTRAINT withdrawals_iban_format CHECK (iban ~ '^IR[0-9]{24}$'),
  holder_name      TEXT              NOT NULL CONSTRAINT withdrawals_holder_length CHECK (char_length(holder_name) BETWEEN 2 AND 120),
  status           withdrawal_status NOT NULL DEFAULT 'pending',
  hold_ledger_id   BIGINT            REFERENCES wallet_ledger (id) ON DELETE RESTRICT,
  return_ledger_id BIGINT            REFERENCES wallet_ledger (id) ON DELETE RESTRICT,
  paid_ref         TEXT              CONSTRAINT withdrawals_paid_ref_length CHECK (char_length(paid_ref) BETWEEN 3 AND 60),
  reject_reason    TEXT              CONSTRAINT withdrawals_reason_length CHECK (char_length(reject_reason) <= 300),
  decided_by       BIGINT            REFERENCES users (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  decided_at       TIMESTAMPTZ,
  CONSTRAINT withdrawals_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT withdrawals_paid_has_ref CHECK (status <> 'paid' OR paid_ref IS NOT NULL)
);
CREATE INDEX withdrawals_user_idx ON withdrawals (user_id, id DESC);
CREATE INDEX withdrawals_status_idx ON withdrawals (status, id DESC);

CREATE FUNCTION withdrawals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.iban IS DISTINCT FROM OLD.iban
     OR NEW.holder_name IS DISTINCT FROM OLD.holder_name OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a withdrawal''s user, amount and account cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'withdrawal is already % and cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  -- a ledger link is set once
  IF (OLD.hold_ledger_id IS NOT NULL AND NEW.hold_ledger_id IS DISTINCT FROM OLD.hold_ledger_id)
     OR (OLD.return_ledger_id IS NOT NULL AND NEW.return_ledger_id IS DISTINCT FROM OLD.return_ledger_id) THEN
    RAISE EXCEPTION 'a withdrawal''s ledger link cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER withdrawals_guard BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION withdrawals_guard();

-- Down Migration
DROP TABLE withdrawals;
DROP FUNCTION withdrawals_guard();
DROP TYPE withdrawal_status;
DROP INDEX payments_user_topup_idx;
ALTER TABLE payments DROP CONSTRAINT payments_kind_link;
ALTER TABLE payments ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE payments DROP COLUMN user_id, DROP COLUMN kind;
ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_sign;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_sign CHECK (
  (kind IN ('topup', 'refund', 'commission') AND amount > 0) OR (kind IN ('order_payment', 'withdrawal') AND amount < 0)
);
