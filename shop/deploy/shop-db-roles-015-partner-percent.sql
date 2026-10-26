-- Step 15 of the shop's database roles: the partner discount shown to customers is capped at OUR_BASE_MARGIN_PERCENT.
--
-- Step 14 gave the customer the whole partner discount (1 − cost/price, two decimals). In real data that is 5%,
-- while Liateam announces 4%. Now (mode 'partner'):
--   displayed / applied base  = LEAST(real partner %, base_margin)        base_margin = OUR_BASE_MARGIN_PERCENT (4)
--   final price               = Liateam's price × (1 − that %), rounded up to 100 toman, never under the purchase
--                               price (the floor is still cost); a bigger discount (admin, campaign, Liateam's own
--                               sale) REPLACES the base, it never adds to it
--   a product whose real partner discount is under 4% gets that smaller one (its price cannot go under cost)
-- shop_offer_prices_v3 now also returns max_pct: the biggest discount that needs no «sell at a loss» tick (the real
-- partner % — a number the shop already shows as a price), next to base_pct (the capped percent on the cards).
-- The «special» flag compares with the capped base. shop_pack_price returns a row for a pack with NO discount even
-- when an item's purchase price is unknown: that pack is just the sum of its items and needs no cost at all.
-- No cost_price ever leaves the database. Needs step 14. Run as the database owner:
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-015-partner-percent.sql
-- Safe to rerun (CREATE OR REPLACE / DROP IF EXISTS), one transaction.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.shop_offer_prices_v3(integer[],numeric[],bigint[],boolean[],text,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'step 14 (shop-db-roles-014-partner-pricing.sql) must run first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.shop_offer_price_mode(
  price bigint, cost bigint, liateam_pct numeric, mode text, manual_pct numeric, manual_amt bigint,
  base_margin numeric, cap numeric, min_margin numeric, no_floor boolean)
RETURNS TABLE (final_toman bigint, clamped boolean)
LANGUAGE sql IMMUTABLE
AS $$
  WITH x AS (
    SELECT greatest(0, coalesce(manual_pct, 0)) + greatest(0, coalesce(manual_amt, 0))::numeric * 100 / price AS manual,
           greatest(0, coalesce(liateam_pct, 0)) AS consumer,
           -- the real partner discount, capped at the announced one
           least(greatest(0, round((1 - cost::numeric / price) * 100, 2)), greatest(0, base_margin)) AS partner,
           greatest(0, (1 - cost::numeric / price) * 100 - base_margin) AS excess
  ), t AS (
    SELECT CASE mode
             WHEN 'partner' THEN greatest(partner, consumer, manual)          -- the best single discount
             WHEN 'beyond_base' THEN excess + manual
             WHEN 'excess' THEN excess + manual
             ELSE consumer + manual                                           -- 'consumer' / 'liateam'
           END AS total
      FROM x
  ), w AS (
    SELECT (ceil(price * (1 - least(total, cap) / 100) / 100) * 100)::bigint AS wanted,
           (ceil(cost * (1 + CASE WHEN mode = 'partner' THEN 0 ELSE min_margin END / 100) / 100) * 100)::bigint AS floor
      FROM t
  )
  SELECT least(price, CASE WHEN no_floor THEN wanted ELSE greatest(wanted, floor) END), wanted <= floor FROM w
$$;

-- the result gained a column: drop the old shape first
DROP FUNCTION IF EXISTS public.shop_offer_prices_v3(integer[], numeric[], bigint[], boolean[], text, numeric, numeric, numeric);

CREATE FUNCTION public.shop_offer_prices_v3(
  ids integer[], manual_pct numeric[], manual_amt bigint[], allow_loss boolean[],
  mode text, base_margin numeric, cap numeric, min_margin numeric)
RETURNS TABLE (id integer, final_toman bigint, clamped boolean, special boolean, base_pct numeric, max_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id, o.final_toman, o.clamped,
         o.final_toman < p.price
           AND (mode <> 'partner' OR o.final_toman < b.final_toman OR p.consumer_discount_percent > 0),
         -- the percent shown on the cards for the base alone (capped at base_margin in partner mode)
         CASE WHEN mode = 'partner'
              THEN least(greatest(0, round((1 - p.cost_price::numeric / p.price) * 100, 2)), greatest(0, least(base_margin, 100)))
              ELSE greatest(0, round((1 - p.cost_price::numeric / p.price) * 100, 2)) END,
         -- the biggest discount without «sell at a loss»: down to the purchase price
         greatest(0, round((1 - p.cost_price::numeric / p.price) * 100, 2))
    FROM unnest(ids, manual_pct, manual_amt, allow_loss) AS u(id, pct, amt, loss)
    JOIN public.product_catalog p ON p.id = u.id AND p.price > 0 AND p.cost_price > 0
   CROSS JOIN LATERAL public.shop_offer_price_mode(
         p.price, p.cost_price, least(greatest(p.consumer_discount_percent, 0), 90), mode,
         least(greatest(u.pct, 0), 100), greatest(u.amt, 0),
         least(greatest(base_margin, 0), 100), least(greatest(cap, 0), 90), least(greatest(min_margin, 0), 100),
         coalesce(u.loss, false)) o
   CROSS JOIN LATERAL public.shop_offer_price_mode(
         p.price, p.cost_price, 0, 'partner', 0, 0,
         least(greatest(base_margin, 0), 100), least(greatest(cap, 0), 90), 0, false) b
$$;

-- a pack with no discount is the sum of its items: no purchase price needed (an unknown cost no longer hides it)
CREATE OR REPLACE FUNCTION public.shop_pack_price(
  ids integer[], display_total bigint, kind text, value bigint, min_margin numeric, no_floor boolean)
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
           (ceil(coalesce(c.cost, 0) * (1 + least(greatest(min_margin, 0), 100) / 100) / 100) * 100)::bigint AS floor
      FROM c
     WHERE c.n > 0 AND display_total > 0 AND kind IN ('percent', 'fixed_price')
       AND (c.unknown = 0 OR (kind = 'percent' AND value = 0))
  )
  SELECT least(display_total, CASE WHEN no_floor THEN wanted ELSE greatest(wanted, floor) END),
         wanted < display_total AND wanted <= floor
    FROM w
$$;

REVOKE ALL ON FUNCTION public.shop_offer_price_mode(bigint, bigint, numeric, text, numeric, bigint, numeric, numeric,
  numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shop_offer_prices_v3(integer[], numeric[], bigint[], boolean[], text, numeric, numeric,
  numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_offer_prices_v3(integer[], numeric[], bigint[], boolean[], text, numeric,
  numeric, numeric) TO lia_shop_staging, lia_shop;
GRANT EXECUTE ON FUNCTION public.shop_pack_price(integer[], bigint, text, bigint, numeric, boolean)
  TO lia_shop_staging, lia_shop;

COMMIT;
