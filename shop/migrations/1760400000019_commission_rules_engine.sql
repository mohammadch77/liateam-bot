-- Up Migration
-- The commission engine's rule columns. commission_rules (migration 015) is still EMPTY and gets no default row: the client
-- has not decided any percentage or amount. A rule says: for referrers at `level` (1 = the buyer's referrer, 2 = that
-- referrer's referrer ...), on goods in `scope`, pay `value` (percent of the goods' selling price, or a fixed toman amount per
-- order), only on orders of at least min_order_total, at most max_per_order per order, held hold_days after the order is sent
-- before it can be approved. The app role edits rules (INSERT/UPDATE) and never deletes: a rule is switched off (active).
ALTER TABLE commission_rules
  ADD COLUMN scope_type     TEXT     NOT NULL DEFAULT 'all'
    CONSTRAINT commission_rules_scope_type CHECK (scope_type IN ('all', 'category', 'brand', 'product')),
  ADD COLUMN scope_id       BIGINT   CONSTRAINT commission_rules_scope_id_positive CHECK (scope_id > 0), -- category code / brand code / product id (Liateam's)
  ADD COLUMN level          SMALLINT NOT NULL DEFAULT 1 CONSTRAINT commission_rules_level_range CHECK (level BETWEEN 1 AND 5),
  ADD COLUMN max_per_order  BIGINT   CONSTRAINT commission_rules_cap_positive CHECK (max_per_order > 0),
  ADD COLUMN hold_days      SMALLINT NOT NULL DEFAULT 0 CONSTRAINT commission_rules_hold_range CHECK (hold_days BETWEEN 0 AND 365),
  ADD COLUMN approve_on     TEXT     NOT NULL DEFAULT 'sent' CONSTRAINT commission_rules_approve_on CHECK (approve_on IN ('sent')),
  ADD CONSTRAINT commission_rules_scope_consistent CHECK ((scope_type = 'all') = (scope_id IS NULL));
ALTER TABLE commission_rules ALTER COLUMN level DROP DEFAULT, ALTER COLUMN scope_type DROP DEFAULT,
  ALTER COLUMN hold_days DROP DEFAULT;
CREATE INDEX commission_rules_level_idx ON commission_rules (level) WHERE active;

-- which level of the chain a commission was for (a referrer holds at most one per order: UNIQUE (order_id, affiliate_user_id))
ALTER TABLE commissions ADD COLUMN level SMALLINT NOT NULL DEFAULT 1 CONSTRAINT commissions_level_range CHECK (level BETWEEN 1 AND 5);

-- Down Migration
ALTER TABLE commissions DROP COLUMN level;
DROP INDEX commission_rules_level_idx;
ALTER TABLE commission_rules
  DROP CONSTRAINT commission_rules_scope_consistent,
  DROP COLUMN approve_on, DROP COLUMN hold_days, DROP COLUMN max_per_order, DROP COLUMN level,
  DROP COLUMN scope_id, DROP COLUMN scope_type;
