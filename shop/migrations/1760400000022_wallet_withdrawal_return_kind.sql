-- Up Migration
-- A rejected or cancelled withdrawal returns the held money with its own ledger kind (positive). A new enum value cannot be used
-- in the transaction that adds it, so the sign rule that mentions it is in the next migration.
ALTER TYPE wallet_entry_kind ADD VALUE IF NOT EXISTS 'withdrawal_return';

-- Down Migration
-- (an enum value cannot be removed; nothing to undo)
SELECT 1;
