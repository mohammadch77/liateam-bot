-- Up Migration
-- Commission payout (task G).
-- 1. A rule may ask for a manual approval: its commissions are paid into the wallet only when an admin approves them. The commission
--    remembers it (snapshot at creation, so a later edit of the rule does not change a commission already made).
ALTER TABLE commission_rules ADD COLUMN manual_approval BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE commissions
  ADD COLUMN manual_approval BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN approved_by     BIGINT  REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN cancel_reason   TEXT    CONSTRAINT commissions_cancel_reason_length CHECK (char_length(cancel_reason) <= 300);

-- 2. A paid commission always points at its wallet row (the payout); the automatic payout looks for due ones by release date.
ALTER TABLE commissions ADD CONSTRAINT commissions_paid_has_entry CHECK (status <> 'paid' OR wallet_entry_id IS NOT NULL);
CREATE INDEX commissions_due_idx ON commissions (release_at) WHERE status = 'pending' AND NOT manual_approval;
CREATE INDEX commissions_created_idx ON commissions (affiliate_user_id, created_at);

-- Down Migration
DROP INDEX commissions_created_idx;
DROP INDEX commissions_due_idx;
ALTER TABLE commissions DROP CONSTRAINT commissions_paid_has_entry;
ALTER TABLE commissions DROP COLUMN cancel_reason, DROP COLUMN approved_by, DROP COLUMN manual_approval;
ALTER TABLE commission_rules DROP COLUMN manual_approval;
