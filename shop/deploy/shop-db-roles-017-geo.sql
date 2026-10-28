-- Step 17 of the shop's database roles: Liateam's provinces and cities for the checkout address form.
--
-- The shop cannot call Liateam; the sync bot's order service already answers a «geo» job (src/orders.mjs: provinces, or
-- the cities of one province, read live from Liateam and cached for a day). Two SECURITY DEFINER functions put such a job
-- in the queue and read its answer — nothing else of the bot's queue is opened, and the answer is a list of {id, name}.
--   shop_enqueue_geo(province_id)   NULL = the provinces, a number = that province's cities; a waiting identical job is reused
--   shop_geo_result(job)            done, ok, result (a JSON list [{id, name}] or {error})
-- Needs step 16 (shop-db-roles-016-orders.sql). Run once as the database owner (safe to rerun):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-017-geo.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.shop_enqueue_review(integer, jsonb, integer)') IS NULL THEN
    RAISE EXCEPTION 'run shop-db-roles-016-orders.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.shop_enqueue_geo(p_province_id integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id integer;
BEGIN
  IF p_province_id IS NOT NULL AND p_province_id <= 0 THEN
    RAISE EXCEPTION 'province_id must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- the same question already waiting (or answered in the last minute) is not asked again
  SELECT id INTO v_id FROM public.order_jobs
   WHERE kind = 'geo' AND requested_by = 'shop' AND created_at > now() - interval '1 minute'
     AND coalesce((payload->>'province_id')::int, 0) = coalesce(p_province_id, 0)
   ORDER BY id DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.order_jobs (kind, payload, requested_by)
  VALUES ('geo', jsonb_strip_nulls(jsonb_build_object('province_id', p_province_id)), 'shop')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.shop_geo_result(p_job_id integer)
RETURNS TABLE (done boolean, ok boolean, result jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT j.done_at IS NOT NULL, coalesce(j.ok, false), j.result
    FROM public.order_jobs j
   WHERE j.id = p_job_id AND j.kind = 'geo' AND j.requested_by = 'shop'
$$;

REVOKE ALL ON FUNCTION public.shop_enqueue_geo(integer), public.shop_geo_result(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_enqueue_geo(integer), public.shop_geo_result(integer) TO lia_shop_staging, lia_shop;

COMMIT;
