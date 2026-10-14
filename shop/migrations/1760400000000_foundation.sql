-- Up Migration
-- Shared building blocks. Every name is unqualified: the runner sets search_path to the target schema
-- (shop or shop_staging), so the same file serves both environments.

-- Guard: refuse to run anywhere but a shop schema (e.g. never create objects in public by accident).
DO $$
BEGIN
  IF current_schema() IS NULL OR current_schema() !~ '^shop(_staging)?$' THEN
    RAISE EXCEPTION 'migrations must run with search_path = shop or shop_staging (got %)', current_schema();
  END IF;
END $$;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE user_role   AS ENUM ('customer', 'affiliate', 'support', 'employee', 'admin');
CREATE TYPE otp_purpose AS ENUM ('login', 'register');

-- Down Migration
DROP TYPE otp_purpose;
DROP TYPE user_role;
DROP TYPE user_status;
DROP FUNCTION set_updated_at();
