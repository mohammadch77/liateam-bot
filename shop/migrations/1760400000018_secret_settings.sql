-- Up Migration
-- Secrets entered in the admin panel (SMS / payment keys for S2), sealed with AES-256-GCM before they reach the database.
-- The key itself lives only in the server's environment (SETTINGS_ENCRYPTION_KEY); this table holds ciphertext.
--   ciphertext  the encrypted value followed by its 16-byte GCM tag
--   nonce       12 random bytes, unique per encryption (UNIQUE: a repeated nonce under one key would break GCM)
--   key_version which key of the ring sealed it (rotation: raise the version, keep the old key as «old key»)
--   hint        the last 4 characters of a long secret, for the masked display ••••1234 (empty for short ones)
-- The app role gets SELECT/INSERT/UPDATE from the default privileges and never DELETE: a secret is replaced, not removed.
CREATE TABLE secret_settings (
  key         TEXT        PRIMARY KEY CONSTRAINT secret_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  ciphertext  BYTEA       NOT NULL CONSTRAINT secret_settings_ciphertext_size CHECK (octet_length(ciphertext) BETWEEN 17 AND 1024),
  nonce       BYTEA       NOT NULL CONSTRAINT secret_settings_nonce_size CHECK (octet_length(nonce) = 12)
                          CONSTRAINT secret_settings_nonce_key UNIQUE,
  key_version SMALLINT    NOT NULL CONSTRAINT secret_settings_key_version CHECK (key_version >= 1),
  hint        TEXT        NOT NULL DEFAULT '' CONSTRAINT secret_settings_hint_length CHECK (char_length(hint) <= 4),
  updated_by  BIGINT      REFERENCES users (id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER secret_settings_set_updated_at BEFORE UPDATE ON secret_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE secret_settings;
