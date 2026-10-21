-- Step 11 of the shop's database roles: Liateam's search tags («best-selling», «popular», «newest») for the home
-- «پرفروش‌ترین‌ها» section. The table holds no price (checked below); the shop only reads it.
-- Run once as the database owner:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-011-product-tags.sql
-- Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.product_tags') IS NULL THEN
    RAISE EXCEPTION 'public.product_tags missing: run the updated sync bot once, then rerun this file';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'product_tags'
                AND column_name ~* '(price|cost|payable|discount)') THEN
    RAISE EXCEPTION 'product_tags has a price-like column: review it before granting';
  END IF;
END $$;

GRANT SELECT ON public.product_tags TO lia_shop_staging, lia_shop;

COMMIT;
