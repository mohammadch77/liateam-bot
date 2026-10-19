-- Step 8 of the shop's database roles: lets the shop read the product facts the sync bot now keeps — size, Liateam's
-- product colour (gallery backdrop), shelf life (product_catalog columns) and the «مناسب برای» concerns
-- (public.product_concerns). Brand banners are new columns of public.brands, already readable (step 5).
-- Liateam's meta texts and search tags are stored for reference only and are NOT granted.
-- Run once as the database owner, after the bot has run once with the new version:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-008-product-facts.sql
-- No price anywhere in it (checked below). Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.product_concerns') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'product_catalog' AND column_name = 'expire_months') THEN
    RAISE EXCEPTION 'product facts missing: run the updated sync bot once, then rerun this file';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name IN ('product_concerns', 'product_tags')
                AND column_name ~* '(price|cost|payable|discount)') THEN
    RAISE EXCEPTION 'a product-facts table has a price-like column: review it before granting';
  END IF;
END $$;

GRANT SELECT (measurement_value, measurement_unit, color, expire_months)
   ON public.product_catalog TO lia_shop_staging, lia_shop;
GRANT SELECT ON public.product_concerns TO lia_shop_staging, lia_shop;

COMMIT;
