-- Step 19 of the shop's database roles: the operator (admin) working a shop order from the shop's panel.
--
-- Two SECURITY DEFINER functions, both limited to origin = 'shop' orders, with a fixed search_path. Nothing else is opened: the shop
-- still has no INSERT/UPDATE/DELETE on any bot table, and the bot's code is not touched.
--   shop_operator_cancel_order(order)   the operator cancelling a shop order that was NOT paid at Liateam: queued, needs_review, or
--                                       awaiting_payment (placed at Liateam, the 20-minute payment link not paid; Liateam lets that
--                                       order lapse by itself). A place job already running makes it return false (too late). A
--                                       waiting place job is closed. Same shape as shop_cancel_order (018), which stays for customers.
--   shop_order_review_info(order)       WHY a shop order stopped in needs_review: the bot's reason text and the two totals it compared
--                                       (Liateam's live total and the total the customer was shown) and the missing product ids, from
--                                       the bot's last needs_review event. These totals are the customer-facing Liateam totals, never
--                                       a purchase price (the bot's event keeps cost and profit elsewhere and they are not returned).
-- Run once as the database owner (safe to rerun):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-019-operator.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.shop_operator_cancel_order(p_order_id integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.shop_orders WHERE id = p_order_id AND origin = 'shop' FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('queued', 'needs_review', 'awaiting_payment') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_jobs
              WHERE kind = 'place' AND (payload->>'order_id')::int = p_order_id AND picked_at IS NOT NULL AND done_at IS NULL) THEN
    RETURN false;
  END IF;
  UPDATE public.order_jobs
     SET picked_at = now(), done_at = now(), ok = false, result = jsonb_build_object('error', 'canceled by the operator')
   WHERE kind = 'place' AND requested_by = 'shop' AND (payload->>'order_id')::int = p_order_id AND picked_at IS NULL AND done_at IS NULL;
  UPDATE public.shop_orders SET status = 'canceled' WHERE id = p_order_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.shop_order_review_info(p_order_id integer)
RETURNS TABLE (reason text, why text, live_total bigint, expected_total bigint, missing jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.data->>'reason',
         o.last_error,
         CASE WHEN e.data->>'live_total' ~ '^[0-9]{1,15}$' THEN (e.data->>'live_total')::bigint END,
         CASE WHEN e.data->>'expected_total' ~ '^[0-9]{1,15}$' THEN (e.data->>'expected_total')::bigint END,
         CASE WHEN jsonb_typeof(e.data->'missing') = 'array' THEN e.data->'missing' END
    FROM public.shop_orders o
    LEFT JOIN LATERAL (SELECT data FROM public.shop_order_events
                        WHERE order_id = o.id AND kind = 'needs_review' ORDER BY id DESC LIMIT 1) e ON true
   WHERE o.id = p_order_id AND o.origin = 'shop' AND o.status = 'needs_review'
$$;

REVOKE ALL ON FUNCTION public.shop_operator_cancel_order(integer), public.shop_order_review_info(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_operator_cancel_order(integer), public.shop_order_review_info(integer)
  TO lia_shop_staging, lia_shop;

COMMIT;
