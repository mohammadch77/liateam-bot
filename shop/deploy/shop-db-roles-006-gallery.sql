-- Step 6 of the shop's database roles: lets the shop read the product photo gallery the sync bot keeps
-- (public.product_images + product_catalog.gallery_count). Run once as the database owner, after the bot has run
-- once with the new version:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-006-gallery.sql
-- No price anywhere in it (checked below). Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.product_images') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'product_catalog' AND column_name = 'gallery_count') THEN
    RAISE EXCEPTION 'gallery table/column missing: run the updated sync bot once, then rerun this file';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'product_images'
                AND column_name ~* '(price|cost|payable|discount)') THEN
    RAISE EXCEPTION 'product_images has a price-like column: review it before granting';
  END IF;
END $$;

GRANT SELECT (gallery_count) ON public.product_catalog TO lia_shop_staging, lia_shop;
GRANT SELECT ON public.product_images TO lia_shop_staging, lia_shop;

COMMIT;
