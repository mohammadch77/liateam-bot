-- Step 7 of the shop's database roles: lets the shop read the home-page hero slides the sync bot mirrors from
-- Liateam (public.hero_slides). Run once as the database owner, after the bot has run once with the new version:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-007-hero.sql
-- No price anywhere in it (checked below). Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.hero_slides') IS NULL THEN
    RAISE EXCEPTION 'hero_slides missing: run the updated sync bot once, then rerun this file';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'hero_slides'
                AND column_name ~* '(price|cost|payable|discount)') THEN
    RAISE EXCEPTION 'hero_slides has a price-like column: review it before granting';
  END IF;
END $$;

GRANT SELECT ON public.hero_slides TO lia_shop_staging, lia_shop;

COMMIT;
