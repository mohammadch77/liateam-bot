-- Up Migration
-- A commission remembers the rule's kind and value AS THEY WERE when it was made (task K): the affiliate's order list shows «the
-- percent (or the fixed amount) applied to this order», and an admin editing the rule later must not change what an old row says.
-- Older rows are filled once from the rule they point at. The guard trigger only protects order, affiliate and amounts, so these
-- columns can be filled; the application sets them on insert and never changes them.
ALTER TABLE commissions
  ADD COLUMN rule_kind  TEXT CONSTRAINT commissions_rule_kind CHECK (rule_kind IN ('percent', 'fixed')),
  ADD COLUMN rule_value NUMERIC(12, 4);
UPDATE commissions c SET rule_kind = r.kind, rule_value = r.value FROM commission_rules r WHERE r.id = c.rule_id;
-- the orders of one referred person, newest first
CREATE INDEX commissions_affiliate_order_idx ON commissions (affiliate_user_id, order_id);

-- Down Migration
DROP INDEX commissions_affiliate_order_idx;
ALTER TABLE commissions DROP COLUMN rule_value, DROP COLUMN rule_kind;
