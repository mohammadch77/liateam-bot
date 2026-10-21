-- Up Migration
-- «پرفروش‌ترین‌ها»: the admin's own picks per home tab (in order, before Liateam's best-selling tag and the fill-up),
-- and small site switches (use Liateam's tag per tab, the magazine section). The app never deletes rows: a pick taken
-- off the list is switched off (enabled = false) and comes back when added again.
CREATE TABLE bestseller_picks (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tab_key    TEXT        NOT NULL CONSTRAINT bestseller_tab CHECK (tab_key IN ('all', 'skin', 'makeup', 'scent', 'hair')),
  product_id INTEGER     NOT NULL,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  created_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tab_key, product_id)
);
CREATE INDEX bestseller_picks_tab_idx ON bestseller_picks (tab_key, sort_order) WHERE enabled;

-- key → JSON value (e.g. 'bestsellers.use_tag.skin' → true, 'magazine.enabled' → false)
CREATE TABLE site_settings (
  key        TEXT        PRIMARY KEY CONSTRAINT site_setting_key CHECK (key ~ '^[a-z0-9_.-]{3,80}$'),
  value      JSONB       NOT NULL,
  updated_by BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE site_settings;
DROP TABLE bestseller_picks;
