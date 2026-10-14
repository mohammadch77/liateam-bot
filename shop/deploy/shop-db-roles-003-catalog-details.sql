-- Step 3 of the shop's database roles: lets the shop read the two new catalog columns (brand, description) that
-- the sync bot adds to public.product_catalog. Run once as the database owner, after the bot has run once with
-- the new version (it adds the columns):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-003-catalog-details.sql
-- Column-level grants (as in shop-db-roles.sql): cost_price stays unreadable for the shop.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'product_catalog' AND column_name = 'description') THEN
    RAISE EXCEPTION 'product_catalog has no description column yet: run the updated sync bot once, then rerun this file';
  END IF;
END $$;

GRANT SELECT (description, brand) ON public.product_catalog TO lia_shop_staging, lia_shop;

COMMIT;
