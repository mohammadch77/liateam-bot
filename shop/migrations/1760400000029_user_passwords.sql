-- Up Migration
-- Password-based authentication & password reset via OTP:
-- Users set a mandatory password during registration and can reset it via SMS OTP.
-- Existing OTP-only users keep password_hash = NULL until they set one via forgot-password.
ALTER TYPE otp_purpose ADD VALUE IF NOT EXISTS 'reset_password';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;

-- Down Migration
ALTER TABLE users
  DROP COLUMN IF EXISTS password_updated_at,
  DROP COLUMN IF EXISTS password_hash;
