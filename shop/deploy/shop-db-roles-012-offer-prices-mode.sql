-- Step 12 of the shop's database roles: the customer's price with a choice of how Liateam's discount is applied.
--
--   mode 'liateam' (default in the shop)  the discount liateam.ir itself shows the customer
--                                         (product_catalog.consumer_discount_percent, written by the sync bot;
--                                         0 when Liateam shows none) — the same percent as on liateam.ir
--   mode 'excess'                         the formula of step 9: Liateam's discount to our account
--                                         (1 − cost/price) above our base margin
-- In both modes our own manual discount comes on top, the total is capped, and the price never goes under the
-- purchase price + the minimum margin (unless the admin allowed a loss on that discount). As in step 9 the shop gets
-- the final price and a yes/no only: no purchase price, no Liateam partner discount, no margin ever leaves.
-- Needs the bot's column consumer_discount_percent (the bot updated and run once): stops with a message otherwise.
-- Step 9's functions stay (a shop build that does not know this step keeps working); nothing is dropped.
-- Run once as the database owner:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-012-offer-prices-mode.sql
-- Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'product_catalog'
                    AND column_name = 'consumer_discount_percent') THEN
    RAISE EXCEPTION 'public.product_catalog.consumer_discount_percent missing: update the sync bot and let it run once';
  END IF;
END $$;

/*
 * price, cost          Liateam's consumer price and our purchase price (toman)
 * liateam_pct          the discount liateam.ir shows the customer (percent)
 * mode                 'liateam' or 'excess' (anything else: 'liateam')
 * manual_pct/_amt      our own discount (percent / toman; 0 = none)
 * base_margin          'excess' only: the part of Liateam's discount to us we keep
 * cap, min_margin, no_floor   as in step 9
 * → final_toman        rounded up to 100 toman, never above `price`
 * → clamped            true when the price reaches the floor
 */
CREATE OR REPLACE FUNCTION public.shop_offer_price_mode(
  price bigint, cost bigint, liateam_pct numeric, mode text, manual_pct numeric, manual_amt bigint,
  base_margin numeric, cap numeric, min_margin numeric, no_floor boolean)
RETURNS TABLE (final_toman bigint, clamped boolean)
LANGUAGE sql IMMUTABLE
AS $$
  WITH x AS (
    SELECT CASE WHEN mode = 'excess' THEN greatest(0, (1 - cost::numeric / price) * 100 - base_margin)
                ELSE greatest(0, coalesce(liateam_pct, 0)) END AS pass,
           greatest(0, coalesce(manual_pct, 0)) + greatest(0, coalesce(manual_amt, 0))::numeric * 100 / price AS manual
  ), w AS (
    SELECT (ceil(price * (1 - least(pass + manual, cap) / 100) / 100) * 100)::bigint AS wanted,
           (ceil(cost * (1 + min_margin / 100) / 100) * 100)::bigint AS floor
      FROM x
  )
  SELECT least(price, CASE WHEN no_floor THEN wanted ELSE greatest(wanted, floor) END), wanted <= floor FROM w
$$;

CREATE OR REPLACE FUNCTION public.shop_offer_prices_mode(
  ids integer[], manual_pct numeric[], manual_amt bigint[], allow_loss boolean[],
  mode text, base_margin numeric, cap numeric, min_margin numeric)
RETURNS TABLE (id integer, final_toman bigint, clamped boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id, o.final_toman, o.clamped
    FROM unnest(ids, manual_pct, manual_amt, allow_loss) AS u(id, pct, amt, loss)
    JOIN public.product_catalog p ON p.id = u.id AND p.price > 0 AND p.cost_price > 0
   CROSS JOIN LATERAL public.shop_offer_price_mode(
         p.price, p.cost_price, least(greatest(p.consumer_discount_percent, 0), 90), mode,
         least(greatest(u.pct, 0), 100), greatest(u.amt, 0),
         least(greatest(base_margin, 0), 100), least(greatest(cap, 0), 90), least(greatest(min_margin, 0), 100),
         coalesce(u.loss, false)) o
$$;

REVOKE ALL ON FUNCTION public.shop_offer_price_mode(bigint, bigint, numeric, text, numeric, bigint, numeric, numeric,
  numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_offer_prices_mode(integer[], numeric[], bigint[], boolean[], text, numeric, numeric,
  numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_offer_prices_mode(integer[], numeric[], bigint[], boolean[], text, numeric,
  numeric, numeric) TO lia_shop_staging, lia_shop;

COMMIT;
