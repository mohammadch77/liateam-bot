-- Step 5 of the shop's database roles: lets the shop read the rich product-page sections the sync bot keeps
-- (specs, how-to-use, video, FAQ, reviews, brands, English slug). Run once as the database owner, after the bot
-- has run once with the new version (it creates the tables and columns):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-005-rich-content.sql
-- Column-level grants on product_catalog (as in shop-db-roles.sql): cost_price stays unreadable. The new tables
-- hold no price at all (checked below, so a later column cannot slip through unnoticed). Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.product_reviews') IS NULL OR to_regclass('public.brands') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'product_catalog' AND column_name = 'slug_en') THEN
    RAISE EXCEPTION 'rich-content tables/columns missing: run the updated sync bot once, then rerun this file';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name IN ('brands', 'product_attributes', 'product_faqs', 'product_reviews')
                AND column_name ~* '(price|cost|payable|discount)') THEN
    RAISE EXCEPTION 'a rich-content table has a price-like column: review it before granting';
  END IF;
END $$;

GRANT SELECT (brand_code, slug_en, slug_fa, summary, features, how_to_use, video_url, video_embed_url,
              rating_value, reviews_total, origin_country)
   ON public.product_catalog TO lia_shop_staging, lia_shop;
GRANT SELECT ON public.brands, public.product_attributes, public.product_faqs, public.product_reviews
   TO lia_shop_staging, lia_shop;

COMMIT;
