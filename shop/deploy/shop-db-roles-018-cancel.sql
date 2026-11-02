-- Step 18 of the shop's database roles: a customer cancelling a PAID order that the operator has not placed at Liateam yet.
--
-- The shop order and the bot's order are two rows. When the customer cancels, the bot's queued order must stop being
-- placeable, or an operator could still place a cancelled order. The bot has no cancel job and its code is not touched; this
-- one SECURITY DEFINER function does the narrow part from the shop's side:
--   shop_cancel_order(order)   only a shop-origin order that is still queued or needs_review (never one being placed or placed),
--                              with no place job already picked up; its waiting place job is closed as failed, then the order
--                              becomes canceled. Returns true when cancelled, false when it is too late (nothing changed).
-- It runs inside the shop's own transaction, so a failed refund rolls the bot's cancel back too. Run once as the database
-- owner (safe to rerun):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-018-cancel.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.shop_cancel_order(p_order_id integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.shop_orders WHERE id = p_order_id AND origin = 'shop' FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('queued', 'needs_review') THEN
    RETURN false;
  END IF;
  -- a place job already picked up is running at Liateam right now: too late
  IF EXISTS (SELECT 1 FROM public.order_jobs
              WHERE kind = 'place' AND (payload->>'order_id')::int = p_order_id AND picked_at IS NOT NULL AND done_at IS NULL) THEN
    RETURN false;
  END IF;
  -- a place job still waiting is closed so the bot never picks it up
  UPDATE public.order_jobs
     SET picked_at = now(), done_at = now(), ok = false, result = jsonb_build_object('error', 'canceled by the customer')
   WHERE kind = 'place' AND requested_by = 'shop' AND (payload->>'order_id')::int = p_order_id AND picked_at IS NULL AND done_at IS NULL;
  UPDATE public.shop_orders SET status = 'canceled' WHERE id = p_order_id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.shop_cancel_order(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_cancel_order(integer) TO lia_shop_staging, lia_shop;

COMMIT;
