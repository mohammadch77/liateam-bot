-- Step 4 of the shop's database setup: fuzzy search (pg_trgm). Run once as the database owner (CREATE EXTENSION
-- needs it; pg_trgm ships with PostgreSQL's contrib package, which Ubuntu installs with the server):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-004-search.sql
-- Idempotent. Adds two functions and one index to the sync bot's supplier_products table; changes no data and no
-- column. The shop reads through the product_catalog view, and Postgres uses the index through it.
--
-- search_norm() must stay identical to normalizeSearch() in shop/src/lib/search/normalize.ts:
--   lower case; Arabic ي ى ئ → ی, ك → ک, ة ۀ → ه, أ إ آ → ا, ؤ → و; ZWNJ → space; Persian/Arabic digits → 0-9;
--   tatweel and harakat removed; everything that is not a letter or digit → space; spaces collapsed.

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.search_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           translate(lower(t),
             'يىئكةۀأإآؤ' || chr(8204) || '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩' || 'ـًٌٍَُِّْٰ',
             'یییکههااا' || 'و' || ' ' || '01234567890123456789'),
           '[^[:alnum:]]+', ' ', 'g'))
$$;

-- The searchable text of a product: its name and brand.
CREATE OR REPLACE FUNCTION public.search_doc(name text, brand text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT public.search_norm(coalesce(name, '') || ' ' || coalesce(brand, ''))
$$;

CREATE INDEX IF NOT EXISTS supplier_products_search_trgm
  ON public.supplier_products USING gin (public.search_doc(name, brand) public.gin_trgm_ops);

GRANT EXECUTE ON FUNCTION public.search_norm(text), public.search_doc(text, text) TO PUBLIC;

COMMIT;
