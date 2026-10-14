-- Step 2 of the shop's database roles (after shop-db-roles.sql). Run once as the database owner:
--   sudo -u postgres psql lia_sync -v staging_pw="'…'" -v prod_pw="'…'" -f shop/deploy/shop-db-roles-002-migrator.sql
--
-- Splits "who changes the structure" from "who uses the data":
--   lia_shop_staging_migrator / lia_shop_migrator  own the schema, run migrations (DDL). Used only by `npm run migrate`.
--   lia_shop_staging          / lia_shop           the running app: SELECT/INSERT/UPDATE only — no DELETE, no DDL.
-- Default privileges make every table a migration creates usable by the app role automatically, so the
-- migration files never name a role and stay identical for both environments.
-- All-or-nothing. Creates no tables and touches nothing of the sync bot.

\set ON_ERROR_STOP on
BEGIN;

CREATE ROLE lia_shop_staging_migrator LOGIN PASSWORD :staging_pw CONNECTION LIMIT 3;
CREATE ROLE lia_shop_migrator         LOGIN PASSWORD :prod_pw    CONNECTION LIMIT 3;

DO $$
DECLARE
  -- schema, migrator (new owner), app role
  envs text[][] := ARRAY[
    ARRAY['shop_staging', 'lia_shop_staging_migrator', 'lia_shop_staging'],
    ARRAY['shop',         'lia_shop_migrator',         'lia_shop']];
  s text; m text; a text;
BEGIN
  FOR i IN 1 .. array_length(envs, 1) LOOP
    s := envs[i][1]; m := envs[i][2]; a := envs[i][3];
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = s) THEN
      RAISE EXCEPTION 'schema % is not empty; move its objects before changing owners', s;
    END IF;

    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', s, m);
    EXECUTE format('GRANT CONNECT ON DATABASE lia_sync TO %I', m);
    -- App role: may use the schema, may not create anything in it.
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM %I', s, a);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, a);

    -- Everything the migrator creates later: data access for the app role, never DELETE/TRUNCATE.
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', m, s, a);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', m, s, a);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', m, s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I', m, s, a);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE USAGE ON TYPES FROM PUBLIC', m, s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE ON TYPES TO %I', m, s, a);
  END LOOP;
END $$;

-- Migrators never need the bot's data.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM lia_shop_staging_migrator, lia_shop_migrator;

COMMIT;
