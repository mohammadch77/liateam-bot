-- Step 9 of the shop's database roles: the discounted price of a product, computed inside the database.
--
-- A customer discount needs the purchase price twice — Liateam's discount to our account (1 − cost/price) passes
-- through above our base margin, and no discount may push the price under the purchase price — but the shop role
-- must never read cost_price. So the database owner keeps that arithmetic here:
--   public.shop_offer_price   the formula itself (pure, numbers in → numbers out); NOT granted to the shop
--   public.shop_offer_prices  for given product ids and the shop's own manual discounts: the final price (toman) and
--                             whether the discount reaches the safety floor (a yes/no, never the floor itself).
--                             A discount the admin marked «loss allowed» is not cut by the floor (still reported).
-- The shop gets EXECUTE on shop_offer_prices only: no cost, no Liateam discount, no margin ever leaves it.
-- Run once as the database owner:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-009-offer-prices.sql
-- Safe to rerun (CREATE OR REPLACE; grants are idempotent).

\set ON_ERROR_STOP on
BEGIN;

-- the first version had no «loss allowed» argument (only ever installed on development machines)
DROP FUNCTION IF EXISTS public.shop_offer_prices(integer[], numeric[], bigint[], numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.shop_offer_price(bigint, bigint, numeric, bigint, numeric, numeric, numeric);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'product_catalog' AND column_name = 'cost_price') THEN
    RAISE EXCEPTION 'public.product_catalog.cost_price missing: is this the sync bot''s database?';
  END IF;
END $$;

/*
 * price, cost          Liateam's consumer price and our purchase price (toman)
 * manual_pct           our own discount in percent (0 = none)
 * manual_amt           our own discount in toman (0 = none)
 * base_margin          percent of Liateam's discount we keep; only the part above it passes to the customer
 * cap                  the customer's total discount never exceeds this percent
 * min_margin           the final price never goes under cost × (1 + min_margin/100) (then rounded up to 100 toman)
 * no_floor             the admin allowed a loss on this discount: the floor does not cut it (the cap still does)
 * → final_toman        rounded up to 100 toman, never above `price`
 * → clamped            true when the discount reaches the floor (with no_floor: it was not cut, but sells at a loss)
 */
CREATE OR REPLACE FUNCTION public.shop_offer_price(
  price bigint, cost bigint, manual_pct numeric, manual_amt bigint,
  base_margin numeric, cap numeric, min_margin numeric, no_floor boolean)
RETURNS TABLE (final_toman bigint, clamped boolean)
LANGUAGE sql IMMUTABLE
AS $$
  WITH x AS (
    SELECT greatest(0, (1 - cost::numeric / price) * 100 - base_margin) AS pass,
           greatest(0, coalesce(manual_pct, 0)) + greatest(0, coalesce(manual_amt, 0))::numeric * 100 / price AS manual
  ), w AS (
    SELECT (ceil(price * (1 - least(pass + manual, cap) / 100) / 100) * 100)::bigint AS wanted,
           (ceil(cost * (1 + min_margin / 100) / 100) * 100)::bigint AS floor
      FROM x
  )
  -- «clamped» also when the discount lands exactly on the floor: the panel refuses that too, so the shown price
  -- is never the purchase price (+ margin) itself
  SELECT least(price, CASE WHEN no_floor THEN wanted ELSE greatest(wanted, floor) END), wanted <= floor FROM w
$$;

CREATE OR REPLACE FUNCTION public.shop_offer_prices(
  ids integer[], manual_pct numeric[], manual_amt bigint[], allow_loss boolean[],
  base_margin numeric, cap numeric, min_margin numeric)
RETURNS TABLE (id integer, final_toman bigint, clamped boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id, o.final_toman, o.clamped
    FROM unnest(ids, manual_pct, manual_amt, allow_loss) AS u(id, pct, amt, loss)
    JOIN public.product_catalog p ON p.id = u.id AND p.price > 0 AND p.cost_price > 0
   CROSS JOIN LATERAL public.shop_offer_price(
         p.price, p.cost_price, least(greatest(u.pct, 0), 100), greatest(u.amt, 0),
         least(greatest(base_margin, 0), 100), least(greatest(cap, 0), 90), least(greatest(min_margin, 0), 100),
         coalesce(u.loss, false)) o
$$;

-- functions are executable by PUBLIC by default: only the shop roles may call the wrapper, nobody else either one
REVOKE ALL ON FUNCTION public.shop_offer_price(bigint, bigint, numeric, bigint, numeric, numeric, numeric, boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_offer_prices(integer[], numeric[], bigint[], boolean[], numeric, numeric, numeric)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_offer_prices(integer[], numeric[], bigint[], boolean[], numeric, numeric, numeric)
   TO lia_shop_staging, lia_shop;

COMMIT;
