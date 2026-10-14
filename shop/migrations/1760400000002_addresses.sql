-- Up Migration
CREATE TABLE addresses (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  province        TEXT        NOT NULL CONSTRAINT addresses_province_length CHECK (char_length(province) BETWEEN 2 AND 60),
  city            TEXT        NOT NULL CONSTRAINT addresses_city_length CHECK (char_length(city) BETWEEN 2 AND 60),
  line            TEXT        NOT NULL CONSTRAINT addresses_line_length CHECK (char_length(line) BETWEEN 5 AND 400),
  recipient_name  TEXT        NOT NULL CONSTRAINT addresses_recipient_name_length CHECK (char_length(recipient_name) BETWEEN 2 AND 120),
  recipient_phone TEXT        NOT NULL CONSTRAINT addresses_recipient_phone_format CHECK (recipient_phone ~ '^09\d{9}$'),
  postal_code     TEXT        NOT NULL CONSTRAINT addresses_postal_code_format CHECK (postal_code ~ '^\d{10}$'),
  is_default      BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_id_idx ON addresses (user_id);
-- At most one default address per user.
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default;
CREATE TRIGGER addresses_set_updated_at BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE addresses;
