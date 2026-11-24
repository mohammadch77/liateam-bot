-- Live Chat module (ported natively from mohammadch77/live-chat for Avina Shop)
-- Strict PostgreSQL ENUMs, real foreign keys, CHAR(36) visitor tokens, single-shop native integration.

DO $$ BEGIN
  CREATE TYPE chat_conversation_status AS ENUM ('pending', 'open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_sender_type AS ENUM ('visitor', 'operator', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_message_type AS ENUM ('text', 'image', 'file', 'audio');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_prechat_field_key AS ENUM ('name', 'email', 'mobile');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_operator_presence AS ENUM ('online', 'away', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chat_widget_position AS ENUM ('bottom_left', 'bottom_right');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. Global live-chat widget settings (singleton row id = 1)
CREATE TABLE IF NOT EXISTS chat_settings (
  id              SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  widget_title    TEXT NOT NULL DEFAULT 'پشتیبانی آنلاین آوینا',
  welcome_message TEXT NOT NULL DEFAULT 'سلام! چطور می‌تونیم در انتخاب محصول یا پیگیری سفارش کمکتون کنیم؟',
  offline_message TEXT NOT NULL DEFAULT 'در حال حاضر پشتیبان آنلاین نیست؛ پیام خود را بگذارید تا در اولین فرصت پاسخ دهیم.',
  position        chat_widget_position NOT NULL DEFAULT 'bottom_left',
  sound_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chat_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Admin-configurable pre-chat fields (name, mobile, email)
CREATE TABLE IF NOT EXISTS chat_prechat_fields (
  field_key   chat_prechat_field_key PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  required    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  SMALLINT NOT NULL DEFAULT 1
);

INSERT INTO chat_prechat_fields (field_key, enabled, required, sort_order) VALUES
  ('name',   TRUE,  TRUE,  1),
  ('mobile', TRUE,  TRUE,  2),
  ('email',  FALSE, FALSE, 3)
ON CONFLICT (field_key) DO NOTHING;

-- 3. Operator presence status (online / away / offline)
CREATE TABLE IF NOT EXISTS chat_operator_status (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status       chat_operator_presence NOT NULL DEFAULT 'online',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Storefront visitors (guest or bound to a signed-in Avina user)
CREATE TABLE IF NOT EXISTS chat_visitors (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_token CHAR(36) NOT NULL UNIQUE,
  user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  name          TEXT,
  email         TEXT,
  mobile        CHAR(11),
  current_url   TEXT,
  current_title TEXT,
  referrer      TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_visitors_mobile_format CHECK (mobile IS NULL OR mobile ~ '^09\d{9}$')
);

CREATE INDEX IF NOT EXISTS chat_visitors_user_id_idx ON chat_visitors(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_visitors_last_seen_idx ON chat_visitors(last_seen_at DESC);

-- 5. Visitor page view history
CREATE TABLE IF NOT EXISTS chat_page_views (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id BIGINT NOT NULL REFERENCES chat_visitors(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_page_views_visitor_idx ON chat_page_views(visitor_id, created_at DESC);

-- 6. Conversations (created atomically with the first message)
CREATE TABLE IF NOT EXISTS chat_conversations (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id          BIGINT NOT NULL REFERENCES chat_visitors(id) ON DELETE CASCADE,
  assigned_user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status              chat_conversation_status NOT NULL DEFAULT 'pending',
  unread_for_operator INTEGER NOT NULL DEFAULT 0 CHECK (unread_for_operator >= 0),
  unread_for_visitor  INTEGER NOT NULL DEFAULT 0 CHECK (unread_for_visitor >= 0),
  last_message_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_conversations_status_idx ON chat_conversations(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_visitor_idx ON chat_conversations(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_assigned_idx ON chat_conversations(assigned_user_id) WHERE assigned_user_id IS NOT NULL;

-- 7. Messages (text, image, file, audio + panel-only system notes)
CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_type     chat_sender_type NOT NULL,
  sender_user_id  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sender_name     TEXT,
  type            chat_message_type NOT NULL DEFAULT 'text',
  body            TEXT,
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  edited_at       TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages(conversation_id, id ASC);

-- 8. Canned responses (shortcut / templates)
CREATE TABLE IF NOT EXISTS chat_canned_responses (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shortcut   TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chat_canned_responses (shortcut, title, body) VALUES
  ('سلام', 'خوش‌آمدگویی', 'سلام و وقت بخیر! خوشحالیم در فروشگاه آوینا همراه شما هستیم. چطور می‌تونم کمکتون کنم؟'),
  ('ارسال', 'زمان و هزینه ارسال', 'سفارش‌ها پس از ثبت نهایی ظرف ۱ تا ۳ روز کاری با بسته‌بندی ایمن به سراسر ایران ارسال می‌شوند.'),
  ('اصالت', 'ضمانت اصالت کالا', 'تمامی محصولات فروشگاه آوینا مستقیم از تأمین‌کننده رسمی تأمین شده و دارای ضمانت اصالت و تاریخ انقضای معتبر هستند.')
ON CONFLICT (shortcut) DO NOTHING;
