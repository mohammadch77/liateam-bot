-- Database roles for the shop. Run once as the database owner:
--   sudo -u postgres psql lia_sync -v staging_pw="'…'" -v prod_pw="'…'" -f shop/deploy/shop-db-roles.sql
-- Creates NO tables and changes NO existing table. Each environment gets its own role and its own empty
-- schema (shop_staging / shop); supplier data is read-only, and cost_price is not readable at all.
-- All-or-nothing: any error rolls everything back. Needs the sync bot's schema (the bot has run once).

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.product_catalog') IS NULL OR to_regclass('public.categories') IS NULL THEN
    RAISE EXCEPTION 'sync bot schema missing: run the sync bot once, then rerun this file';
  END IF;
END $$;

CREATE ROLE lia_shop_staging LOGIN PASSWORD :staging_pw CONNECTION LIMIT 10;
CREATE ROLE lia_shop         LOGIN PASSWORD :prod_pw    CONNECTION LIMIT 20;

CREATE SCHEMA shop_staging AUTHORIZATION lia_shop_staging;
CREATE SCHEMA shop         AUTHORIZATION lia_shop;

-- Staging cannot see production's schema and vice versa.
REVOKE ALL ON SCHEMA shop_staging FROM PUBLIC;
REVOKE ALL ON SCHEMA shop         FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['lia_shop_staging', 'lia_shop'] LOOP
    EXECUTE format('GRANT CONNECT ON DATABASE lia_sync TO %I', r);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
    -- Supplier catalog, read-only, without cost_price (purchase price is internal).
    EXECUTE format('GRANT SELECT (id, uuid, name, price, stock, category, is_available, is_sellable,
                    first_seen_at, updated_at, last_seen_at, category_names, image_url, missing_since)
                    ON public.product_catalog TO %I', r);
    EXECUTE format('GRANT SELECT ON public.categories TO %I', r);
  END LOOP;
END $$;

COMMIT;
