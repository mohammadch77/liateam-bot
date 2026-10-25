-- Step 13 of the shop's database roles: the sync bot's health, read-only, for the shop's admin panel and /health.
--
-- public.shop_sync_status() returns one row of numbers and times only — the last catalog sync (when, its status),
-- how many products the shop shows, how many change events in the last 24 hours, and whether the schedule is paused
-- in the dashboard. No product data, no prices, no event texts. The shop role gets EXECUTE on it and nothing on the
-- bot's tables (sync_runs, change_events, sync_settings stay closed; no DELETE anywhere).
-- Also sets the shop roles' statement and idle-transaction timeouts (below).
-- Run once as the database owner:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-013-sync-status.sql
-- Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.sync_runs') IS NULL OR to_regclass('public.change_events') IS NULL
     OR to_regclass('public.sync_settings') IS NULL THEN
    RAISE EXCEPTION 'sync_runs / change_events / sync_settings missing: is the sync bot updated and run once?';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.shop_sync_status()
RETURNS TABLE (last_sync_at timestamptz, last_sync_status text, last_ok_at timestamptz, products integer,
               events_24h integer, paused boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT (SELECT finished_at FROM public.sync_runs ORDER BY id DESC LIMIT 1),
         (SELECT status FROM public.sync_runs ORDER BY id DESC LIMIT 1),
         (SELECT max(finished_at) FROM public.sync_runs WHERE status IN ('ok', 'warning')),
         (SELECT count(*)::int FROM public.product_catalog p
           WHERE p.is_sellable AND p.price > 0 AND p.missing_since IS NULL),
         (SELECT count(*)::int FROM public.change_events WHERE occurred_at > now() - interval '24 hours'),
         coalesce((SELECT value::text IN ('true', '"true"', '"1"', '1') FROM public.sync_settings
                    WHERE key = 'paused'), false)
$$;

-- the shop roles' own limits in the database (the app sets statement_timeout per connection too; this holds even
-- for a connection that forgets): one statement ≤ 10 s, an idle open transaction is ended after 30 s
ALTER ROLE lia_shop_staging SET statement_timeout = '10s';
ALTER ROLE lia_shop_staging SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE lia_shop SET statement_timeout = '10s';
ALTER ROLE lia_shop SET idle_in_transaction_session_timeout = '30s';

REVOKE ALL ON FUNCTION public.shop_sync_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_sync_status() TO lia_shop_staging, lia_shop;

COMMIT;
