-- Up Migration
-- Affiliate monthly purchase eligibility, maintenance quota & progressive sales commission tiers
-- Supports global defaults (affiliate_global_config) and per-user overrides (affiliate_user_overrides).

CREATE TABLE IF NOT EXISTS affiliate_global_config (
  id                       SMALLINT    PRIMARY KEY DEFAULT 1 CONSTRAINT affiliate_global_singleton CHECK (id = 1),
  join_min_monthly_toman   BIGINT      NOT NULL DEFAULT 2000000 CONSTRAINT affiliate_global_join_nonneg CHECK (join_min_monthly_toman >= 0),
  active_min_monthly_toman BIGINT      NOT NULL DEFAULT 1000000 CONSTRAINT affiliate_global_active_nonneg CHECK (active_min_monthly_toman >= 0),
  tiers                    JSONB       NOT NULL DEFAULT '[{"title":"برنزی","minSalesToman":0,"commissionPercent":5},{"title":"نقره‌ای","minSalesToman":10000000,"commissionPercent":8},{"title":"طلایی","minSalesToman":30000000,"commissionPercent":12},{"title":"الماس","minSalesToman":60000000,"commissionPercent":15}]'::jsonb,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               BIGINT      REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO affiliate_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER affiliate_global_config_set_updated_at
  BEFORE UPDATE ON affiliate_global_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS affiliate_user_overrides (
  user_id                  BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  join_min_monthly_toman   BIGINT      CONSTRAINT affiliate_override_join_nonneg CHECK (join_min_monthly_toman IS NULL OR join_min_monthly_toman >= 0),
  active_min_monthly_toman BIGINT      CONSTRAINT affiliate_override_active_nonneg CHECK (active_min_monthly_toman IS NULL OR active_min_monthly_toman >= 0),
  tiers                    JSONB,
  note                     TEXT        CONSTRAINT affiliate_override_note_len CHECK (note IS NULL OR char_length(note) <= 300),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               BIGINT      REFERENCES users (id) ON DELETE SET NULL
);

CREATE TRIGGER affiliate_user_overrides_set_updated_at
  BEFORE UPDATE ON affiliate_user_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS affiliate_user_overrides;
DROP TABLE IF EXISTS affiliate_global_config;
