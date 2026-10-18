-- Up Migration
-- «همکاری در فروش»: anyone signed in (phone verified by OTP) can apply to sell for the shop; the application waits
-- for an admin. Approving it grants the existing 'affiliate' role (user_roles). Commission and wallet are phase 2.
-- Who did what (submit / approve / reject, with the entry point and IP) is in audit_log.
CREATE TYPE affiliate_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE affiliate_applications (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  full_name     TEXT             NOT NULL CONSTRAINT affiliate_full_name_length CHECK (char_length(full_name) BETWEEN 3 AND 80),
  phone         TEXT             NOT NULL CONSTRAINT affiliate_phone_format CHECK (phone ~ '^09\d{9}$'), -- the account's, at the time
  province      TEXT             NOT NULL CONSTRAINT affiliate_province_length CHECK (char_length(province) BETWEEN 2 AND 40),
  city          TEXT             NOT NULL CONSTRAINT affiliate_city_length CHECK (char_length(city) BETWEEN 2 AND 60),
  channel_type  TEXT             NOT NULL CONSTRAINT affiliate_channel_type CHECK (channel_type IN ('instagram', 'telegram', 'store', 'website', 'other')),
  channel_url   TEXT             NOT NULL CONSTRAINT affiliate_channel_url_length CHECK (char_length(channel_url) BETWEEN 2 AND 200),
  followers     TEXT             CONSTRAINT affiliate_followers CHECK (followers IN ('lt1k', '1k-10k', '10k-50k', '50k-100k', 'gt100k')),
  description   TEXT             NOT NULL CONSTRAINT affiliate_description_length CHECK (char_length(description) BETWEEN 20 AND 1000),
  source        TEXT             NOT NULL DEFAULT 'direct' CONSTRAINT affiliate_source CHECK (source IN ('home', 'footer', 'account', 'direct')),
  status        affiliate_status NOT NULL DEFAULT 'pending',
  ip            INET,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  decided_by    BIGINT           REFERENCES users (id) ON DELETE SET NULL,
  reject_reason TEXT             CONSTRAINT affiliate_reject_reason_length CHECK (char_length(reject_reason) <= 300)
);
-- one application waiting per user (the service checks first and says so; this is the guarantee)
CREATE UNIQUE INDEX affiliate_applications_one_pending ON affiliate_applications (user_id) WHERE status = 'pending';
-- the user's latest application (status page, «try again after 7 days») and rate limiting
CREATE INDEX affiliate_applications_user_idx ON affiliate_applications (user_id, created_at DESC);
CREATE INDEX affiliate_applications_ip_idx ON affiliate_applications (ip, created_at DESC);
-- the admin queue
CREATE INDEX affiliate_applications_status_idx ON affiliate_applications (status, created_at);

-- Down Migration
DROP TABLE affiliate_applications;
DROP TYPE affiliate_status;
