-- Step 10 of the shop's database roles: the price of a pack (several products sold together), computed inside the
-- database like a discount (009): the pack may never go under the items' purchase prices + the minimum margin, and
-- the shop role still never reads cost_price.
--   public.shop_pack_price(ids, display_total, kind, value, min_margin) → (final_toman, clamped)
--     ids            the pack's products (a product twice counts twice)
--     display_total  the sum of the items' current shop prices (after their own discounts), computed by the shop
--     kind / value   'percent' (1–90) off display_total, or 'fixed_price' (toman)
--     → final_toman  rounded up to 100 toman, never above display_total; no row when a product is unknown or has
--                    no purchase price (the shop then shows the pack as unavailable)
--     → clamped      true when the floor decided the price (or the pack price reached it exactly)
-- Run once as the database owner:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-010-pack-prices.sql
-- Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.shop_pack_price(
  ids integer[], display_total bigint, kind text, value bigint, min_margin numeric)
RETURNS TABLE (final_toman bigint, clamped boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH items AS (
    SELECT u.id, p.cost_price
      FROM unnest(ids) AS u(id)
      LEFT JOIN public.product_catalog p ON p.id = u.id AND p.price > 0 AND p.cost_price > 0
  ), c AS (
    SELECT sum(cost_price) AS cost, count(*) FILTER (WHERE cost_price IS NULL) AS unknown, count(*) AS n FROM items
  ), w AS (
    SELECT CASE WHEN kind = 'percent'
                THEN (ceil(display_total * (1 - least(greatest(value, 0), 90)::numeric / 100) / 100) * 100)::bigint
                ELSE greatest(value, 0) END AS wanted,
           (ceil(c.cost * (1 + least(greatest(min_margin, 0), 100) / 100) / 100) * 100)::bigint AS floor
      FROM c
     WHERE c.unknown = 0 AND c.n > 0 AND display_total > 0 AND kind IN ('percent', 'fixed_price')
  )
  SELECT least(display_total, greatest(wanted, floor)), wanted <= floor FROM w
$$;

REVOKE ALL ON FUNCTION public.shop_pack_price(integer[], bigint, text, bigint, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_pack_price(integer[], bigint, text, bigint, numeric)
   TO lia_shop_staging, lia_shop;

COMMIT;
