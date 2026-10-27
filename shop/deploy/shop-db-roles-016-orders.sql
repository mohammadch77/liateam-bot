-- Step 16 of the shop's database roles: the shop's side of the order flow with the sync bot (src/orders.mjs).
--
-- The bot owns the queue (public.order_jobs) and its own order tables. The shop never touches them directly: it gets
--   * four SECURITY DEFINER functions that put a job in the queue and read its answer, in a fixed shape —
--       shop_enqueue_review(city, items)           the live price / stock check of a basket («review»), seconds
--       shop_review_result(job)                    its answer (no purchase price: the bot strips it)
--       shop_enqueue_create(review, customer, address)   the customer paid: the bot creates its queued order
--       shop_create_result(job)                    its answer: the bot's order id
--       shop_enqueue_place(order, expected_total, max_diff)  place it at Liateam now (an operator pays afterwards)
--     Every job is requested_by = 'shop'; results of other kinds ('place' texts can carry purchase prices) are not readable.
--   * SELECT on a few COLUMNS of public.shop_orders and public.shop_order_items — never liateam_total, dry_run_result,
--     last_error, unit_cost; and nothing on shop_order_events (its texts and data carry cost and profit),
--     order_jobs, review_holds or the bot's wallet_ledger.
-- No INSERT/UPDATE/DELETE on any bot table for the shop roles. Needs the bot with shop_orders.origin (the bot adds the
-- column when it starts). Run once as the database owner (safe to rerun):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-016-orders.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.order_jobs') IS NULL OR to_regclass('public.shop_orders') IS NULL
     OR to_regclass('public.shop_order_items') IS NULL THEN
    RAISE EXCEPTION 'the bot''s order tables are missing: update the sync bot and start it once';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'shop_orders' AND column_name = 'origin') THEN
    RAISE EXCEPTION 'public.shop_orders.origin is missing: deploy the bot version with needs_review and restart it first';
  END IF;
END $$;

-- ── nothing direct on the bot's order tables, then exactly these columns ──
REVOKE ALL ON public.order_jobs, public.review_holds, public.wallet_ledger, public.shop_order_events,
              public.shop_orders, public.shop_order_items FROM lia_shop_staging, lia_shop;

GRANT SELECT (id, created_at, status, urgent, items_total, shipping_price, refunded_total, liateam_order_code,
              payment_url, placed_at, supplier_paid_at, sent_at, tracking)
  ON public.shop_orders TO lia_shop_staging, lia_shop;
-- order_id joins an item to its order; unit_cost (what Liateam charged us) stays closed
GRANT SELECT (order_id, product_id, quantity, status)
  ON public.shop_order_items TO lia_shop_staging, lia_shop;

-- ── queue functions ──
CREATE OR REPLACE FUNCTION public.shop_enqueue_review(p_city_id integer, p_items jsonb, p_replaces_review_id integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  e jsonb;
  v_id integer;
  v_replaces integer;
BEGIN
  IF p_city_id IS NULL OR p_city_id <= 0 THEN
    RAISE EXCEPTION 'city_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'items must be a list of 1 to 20 products' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(e) <> 'object' OR e->>'product_id' !~ '^[0-9]{1,9}$' OR e->>'quantity' !~ '^[0-9]{1,2}$'
       OR (e->>'quantity')::int NOT BETWEEN 1 AND 50 THEN
      RAISE EXCEPTION 'each item needs a product_id and a quantity of 1 to 50' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;
  -- only a review the shop itself asked for can be replaced (its hold is released by the bot)
  SELECT id INTO v_replaces FROM public.order_jobs WHERE id = p_replaces_review_id AND kind = 'review' AND requested_by = 'shop';

  INSERT INTO public.order_jobs (kind, payload, requested_by)
  VALUES ('review',
          jsonb_build_object(
            'city_id', p_city_id,
            'items', (SELECT jsonb_agg(jsonb_build_object('product_id', (x->>'product_id')::int, 'quantity', (x->>'quantity')::int))
                        FROM jsonb_array_elements(p_items) x),
            'replaces_review_id', v_replaces),
          'shop')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- done = the bot has answered; ok = it succeeded; result = the review (items, live prices, shipping, total, expires_at)
-- or {error, kind}. Only the shop's own review jobs.
CREATE OR REPLACE FUNCTION public.shop_review_result(p_job_id integer)
RETURNS TABLE (done boolean, ok boolean, result jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT j.done_at IS NOT NULL, coalesce(j.ok, false), j.result
    FROM public.order_jobs j
   WHERE j.id = p_job_id AND j.kind = 'review' AND j.requested_by = 'shop'
$$;

CREATE OR REPLACE FUNCTION public.shop_enqueue_create(p_review_id integer, p_customer jsonb, p_address jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.order_jobs WHERE id = p_review_id AND kind = 'review' AND requested_by = 'shop') THEN
    RAISE EXCEPTION 'unknown review' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_customer->>'mobile' !~ '^09[0-9]{9}$' OR coalesce(p_customer->>'first_name', '') = '' OR coalesce(p_customer->>'last_name', '') = ''
     OR p_address->>'postal_code' !~ '^[0-9]{10}$' OR p_address->>'province_id' !~ '^[0-9]{1,9}$' OR p_address->>'city_id' !~ '^[0-9]{1,9}$'
     OR coalesce(p_address->>'address', '') = '' OR coalesce(p_address->>'plate', '') = '' THEN
    RAISE EXCEPTION 'customer or address is incomplete' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- one create per review: asking again returns the job already made (unless it failed)
  SELECT id INTO v_id FROM public.order_jobs
   WHERE kind = 'create' AND requested_by = 'shop' AND (payload->>'review_id')::int = p_review_id AND (done_at IS NULL OR ok)
   ORDER BY id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.order_jobs (kind, payload, requested_by)
  VALUES ('create',
          jsonb_build_object(
            'review_id', p_review_id,
            'payment', 'gateway', -- the shop has its own wallet; the bot's is never used for a shop order
            'customer', jsonb_build_object('first_name', p_customer->>'first_name', 'last_name', p_customer->>'last_name',
                                           'mobile', p_customer->>'mobile'),
            'address', jsonb_build_object('province_id', (p_address->>'province_id')::int, 'city_id', (p_address->>'city_id')::int,
                                          'postal_code', p_address->>'postal_code', 'address', p_address->>'address',
                                          'plate', p_address->>'plate', 'unit', coalesce(p_address->>'unit', ''))),
          'shop')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.shop_create_result(p_job_id integer)
RETURNS TABLE (done boolean, ok boolean, result jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT j.done_at IS NOT NULL, coalesce(j.ok, false), j.result
    FROM public.order_jobs j
   WHERE j.id = p_job_id AND j.kind = 'create' AND j.requested_by = 'shop'
$$;

-- Place a shop order at Liateam now. expected_total = what the customer was shown, in Liateam's prices incl. shipping:
-- the bot stops the order in needs_review when the live total moved by more than max_diff (default: the bot's own, 10)
-- or an item is short. Returns the job id, or NULL when a place job for this order is already waiting.
CREATE OR REPLACE FUNCTION public.shop_enqueue_place(p_order_id integer, p_expected_total bigint, p_max_diff integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id integer;
BEGIN
  IF p_expected_total IS NULL OR p_expected_total < 0 THEN
    RAISE EXCEPTION 'expected_total is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shop_orders WHERE id = p_order_id AND origin = 'shop' AND status IN ('queued', 'needs_review')) THEN
    RAISE EXCEPTION 'not a shop order waiting to be placed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_jobs WHERE kind = 'place' AND done_at IS NULL AND (payload->>'order_id')::int = p_order_id) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.order_jobs (kind, payload, requested_by)
  VALUES ('place',
          jsonb_strip_nulls(jsonb_build_object('order_id', p_order_id, 'expected_total', p_expected_total, 'max_diff', p_max_diff)),
          'shop')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.shop_enqueue_review(integer, jsonb, integer),
                       public.shop_review_result(integer),
                       public.shop_enqueue_create(integer, jsonb, jsonb),
                       public.shop_create_result(integer),
                       public.shop_enqueue_place(integer, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_enqueue_review(integer, jsonb, integer),
                          public.shop_review_result(integer),
                          public.shop_enqueue_create(integer, jsonb, jsonb),
                          public.shop_create_result(integer),
                          public.shop_enqueue_place(integer, bigint, integer) TO lia_shop_staging, lia_shop;

COMMIT;
