-- Up Migration
-- A pack may have no discount at all (0%): its price is then exactly the sum of its products' prices. New packs start
-- at 0%; only the admin gives a discount (/admin/packs). Existing rows are not changed here (see
-- scripts/packs-reset-discount.mjs for the seeded packs).
ALTER TABLE packs DROP CONSTRAINT pack_discount_value;
ALTER TABLE packs ADD CONSTRAINT pack_discount_value CHECK (
  (discount_kind = 'percent' AND discount_value BETWEEN 0 AND 90)
  OR (discount_kind = 'fixed_price' AND discount_value BETWEEN 1000 AND 10000000000));

-- Down Migration
ALTER TABLE packs DROP CONSTRAINT pack_discount_value;
ALTER TABLE packs ADD CONSTRAINT pack_discount_value CHECK (
  (discount_kind = 'percent' AND discount_value BETWEEN 1 AND 90)
  OR (discount_kind = 'fixed_price' AND discount_value BETWEEN 1000 AND 10000000000));
