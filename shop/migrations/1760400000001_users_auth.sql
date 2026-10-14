-- Up Migration
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone         TEXT        NOT NULL CONSTRAINT users_phone_format CHECK (phone ~ '^09\d{9}$'),
  full_name     TEXT        CONSTRAINT users_full_name_length CHECK (char_length(full_name) BETWEEN 1 AND 120),
  status        user_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ  -- soft delete: rows are never removed (history and orders keep pointing here)
);
-- One live account per phone; a deleted account frees the number for a new sign-up.
CREATE UNIQUE INDEX users_phone_live_key ON users (phone) WHERE deleted_at IS NULL;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       user_role   NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who granted it: kept as evidence, so that user can never be hard-deleted.
  granted_by BIGINT      REFERENCES users (id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role)
);
-- (user_id) is already the leading column of the primary key; a separate index would only duplicate it.
CREATE INDEX user_roles_granted_by_idx ON user_roles (granted_by) WHERE granted_by IS NOT NULL;

CREATE TABLE otp_codes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone       TEXT        NOT NULL CONSTRAINT otp_codes_phone_format CHECK (phone ~ '^09\d{9}$'),
  code_hash   TEXT        NOT NULL CONSTRAINT otp_codes_hash_length CHECK (char_length(code_hash) >= 32), -- never the code itself
  purpose     otp_purpose NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    SMALLINT    NOT NULL DEFAULT 0 CONSTRAINT otp_codes_attempts_range CHECK (attempts BETWEEN 0 AND 100),
  request_ip  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT otp_codes_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT otp_codes_consumed_in_window CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
-- Rate limiting: "codes sent to this phone in the last N minutes".
CREATE INDEX otp_codes_phone_created_idx ON otp_codes (phone, created_at DESC);
-- Rate limiting by IP.
CREATE INDEX otp_codes_ip_created_idx ON otp_codes (request_ip, created_at DESC) WHERE request_ip IS NOT NULL;

CREATE TABLE sessions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL CONSTRAINT sessions_token_hash_key UNIQUE
                         CONSTRAINT sessions_token_hash_length CHECK (char_length(token_hash) >= 32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT        CONSTRAINT sessions_user_agent_length CHECK (char_length(user_agent) <= 512),
  ip         INET,
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
-- "Active sessions of a user" (sign out everywhere, session list).
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;

-- Down Migration
DROP TABLE sessions;
DROP TABLE otp_codes;
DROP TABLE user_roles;
DROP TABLE users;
