-- Up Migration
-- The shop's own wallet: ONE append-only ledger (the sync bot's public.wallet_ledger is separate and is not used for
-- shop orders). A balance is not stored anywhere it could be edited: it is balance_after of a user's latest ledger row,
-- and the trigger below computes that row's balance_after under a per-user lock, so two payments at once cannot spend
-- the same money. A negative balance is refused by the database. Each row carries an idempotency key: the same event
-- arriving twice (a gateway callback, a retried request) inserts once.
CREATE TYPE wallet_entry_kind AS ENUM ('topup', 'order_payment', 'refund', 'withdrawal', 'commission');

CREATE TABLE wallet_ledger (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT            NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind            wallet_entry_kind NOT NULL,
  amount          BIGINT            NOT NULL CONSTRAINT wallet_ledger_amount_nonzero CHECK (amount <> 0), -- TOMAN, signed
  balance_after   BIGINT            NOT NULL CONSTRAINT wallet_ledger_balance_nonneg CHECK (balance_after >= 0), -- set by the trigger
  idempotency_key TEXT              NOT NULL UNIQUE CONSTRAINT wallet_ledger_idempotency_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
  order_id        BIGINT            REFERENCES orders (id) ON DELETE RESTRICT,
  ref             TEXT              CONSTRAINT wallet_ledger_ref_length CHECK (char_length(ref) <= 120),  -- gateway reference, payout reference
  note            TEXT              CONSTRAINT wallet_ledger_note_length CHECK (char_length(note) <= 200),
  created_by      BIGINT            REFERENCES users (id) ON DELETE SET NULL, -- the admin for a manual entry
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  -- money in: topup, refund, commission · money out: order_payment, withdrawal
  CONSTRAINT wallet_ledger_sign CHECK (
    (kind IN ('topup', 'refund', 'commission') AND amount > 0) OR (kind IN ('order_payment', 'withdrawal') AND amount < 0)
  ),
  -- a payment and a refund always belong to an order
  CONSTRAINT wallet_ledger_order_link CHECK (kind NOT IN ('order_payment', 'refund') OR order_id IS NOT NULL)
);
CREATE INDEX wallet_ledger_user_idx ON wallet_ledger (user_id, id DESC);
CREATE INDEX wallet_ledger_order_idx ON wallet_ledger (order_id) WHERE order_id IS NOT NULL;
-- an order is paid from the wallet once
CREATE UNIQUE INDEX wallet_ledger_one_payment_per_order ON wallet_ledger (order_id) WHERE kind = 'order_payment';

CREATE FUNCTION wallet_ledger_next_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior BIGINT;
BEGIN
  -- one writer per user at a time (released at the end of the transaction)
  PERFORM pg_advisory_xact_lock(hashtextextended('wallet:' || NEW.user_id::text, 0));
  SELECT coalesce((SELECT balance_after FROM wallet_ledger WHERE user_id = NEW.user_id ORDER BY id DESC LIMIT 1), 0) INTO prior;
  NEW.balance_after := prior + NEW.amount;
  IF NEW.balance_after < 0 THEN
    RAISE EXCEPTION 'insufficient wallet balance' USING ERRCODE = 'check_violation', CONSTRAINT = 'wallet_ledger_balance_nonneg';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_ledger_balance BEFORE INSERT ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION wallet_ledger_next_balance();
CREATE TRIGGER wallet_ledger_append_only BEFORE UPDATE OR DELETE ON wallet_ledger FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Down Migration
DROP TABLE wallet_ledger;
DROP FUNCTION wallet_ledger_next_balance();
DROP TYPE wallet_entry_kind;
