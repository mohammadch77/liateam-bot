-- Step 14 of the shop's database roles: the «partner» price mode (the default) and the three modes by name.
--
--   partner      (default) the customer gets Liateam's partner discount (1 − cost/price, two decimals, ≈ 4%): price =
--                Liateam's price × (1 − that %), never under the purchase price (zero margin is allowed for this base).
--                Any bigger discount — the admin's manual one on a product / category / brand / everything, a campaign,
--                Liateam's own consumer discount (consumer_discount_percent) — REPLACES the base (the best single one
--                wins, not a sum); the total is capped. Under the purchase price only with the admin's «sell at a loss».
--   consumer     only the discount liateam.ir shows the customer (alias 'liateam'); manual discounts add to it
--   beyond_base  the excess formula of step 9 (alias 'excess')
-- The shop never reads cost_price: it gets the final price, yes/no flags and the (public) partner percent.
--
--   public.shop_offer_price_mode      the formula (pure); extended with 'partner', same signature as step 12 — a shop
--                                     build that does not know step 14 keeps working with its own modes
--   public.shop_offer_prices_v3       ids + the shop's manual discounts → final price, clamped (the floor decided),
--                                     special (a discount beyond the base: for «تخفیفات ویژه»), base_pct (the
--                                     partner percent that is shown on cards anyway)
--   public.shop_pack_price            step 10's pack price; «clamped» now only when the pack discount itself reaches
--                                     the floor (a pack with no discount is the sum of its items: never clamped)
-- Run once as the database owner (needs step 12 and the bot's consumer_discount_percent):
--   sudo -u postgres psql lia_sync -f shop/deploy/shop-db-roles-014-partner-pricing.sql
-- Safe to rerun.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.shop_offer_price_mode(bigint,bigint,numeric,text,numeric,bigint,numeric,numeric,numeric,boolean)') IS NULL THEN
    RAISE EXCEPTION 'step 12 (shop-db-roles-012-offer-prices-mode.sql) must run first';
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
           greatest(0, round((1 - cost::numeric / price) * 100, 2)) AS partner,
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
           -- partner: zero margin is allowed (the base itself is the purchase price)
           (ceil(cost * (1 + CASE WHEN mode = 'partner' THEN 0 ELSE min_margin END / 100) / 100) * 100)::bigint AS floor
      FROM t
  )
  SELECT least(price, CASE WHEN no_floor THEN wanted ELSE greatest(wanted, floor) END), wanted <= floor FROM w
$$;

CREATE OR REPLACE FUNCTION public.shop_offer_prices_v3(
  ids integer[], manual_pct numeric[], manual_amt bigint[], allow_loss boolean[],
  mode text, base_margin numeric, cap numeric, min_margin numeric)
RETURNS TABLE (id integer, final_toman bigint, clamped boolean, special boolean, base_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.id, o.final_toman, o.clamped,
         -- «special»: a discount beyond what everybody gets (partner: more than the base alone; others: any)
         o.final_toman < p.price
           AND (mode <> 'partner' OR o.final_toman < b.final_toman OR p.consumer_discount_percent > 0),
         greatest(0, round((1 - p.cost_price::numeric / p.price) * 100, 2))
    FROM unnest(ids, manual_pct, manual_amt, allow_loss) AS u(id, pct, amt, loss)
    JOIN public.product_catalog p ON p.id = u.id AND p.price > 0 AND p.cost_price > 0
   CROSS JOIN LATERAL public.shop_offer_price_mode(
         p.price, p.cost_price, least(greatest(p.consumer_discount_percent, 0), 90), mode,
         least(greatest(u.pct, 0), 100), greatest(u.amt, 0),
         least(greatest(base_margin, 0), 100), least(greatest(cap, 0), 90), least(greatest(min_margin, 0), 100),
         coalesce(u.loss, false)) o
   CROSS JOIN LATERAL public.shop_offer_price_mode(
         p.price, p.cost_price, 0, 'partner', 0, 0, 0, least(greatest(cap, 0), 90), 0, false) b
$$;

-- step 10's pack price, with «clamped» only when the pack's own discount reaches the floor
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
           (ceil(c.cost * (1 + least(greatest(min_margin, 0), 100) / 100) / 100) * 100)::bigint AS floor
      FROM c
     WHERE c.unknown = 0 AND c.n > 0 AND display_total > 0 AND kind IN ('percent', 'fixed_price')
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
