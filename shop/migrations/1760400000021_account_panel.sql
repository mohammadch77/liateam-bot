-- Up Migration
-- Customer panel (task E): an address is «deleted» by archiving it. The app role cannot DELETE, and an old order keeps its own
-- copy of the address, so nothing else refers to the row. An archived address is never listed or used; if it was the default,
-- the default flag goes with it (the unique one-default index only counts live rows).
ALTER TABLE addresses ADD COLUMN archived_at TIMESTAMPTZ;
CREATE INDEX addresses_live_idx ON addresses (user_id) WHERE archived_at IS NULL;

-- Down Migration
DROP INDEX addresses_live_idx;
ALTER TABLE addresses DROP COLUMN archived_at;
