-- Up Migration
-- Reviews written on our site. Reviews synced from Liateam live in public.product_reviews (the sync bot's
-- table, read-only for the shop; a different name so the search_path never mixes them up); the catalog repository shows both, each tagged with its source. A site review
-- is shown only after an admin approves it (anti-spam): status starts as 'pending'.
CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE site_reviews (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       TEXT          NOT NULL DEFAULT 'site' CONSTRAINT site_reviews_source CHECK (source = 'site'),
  product_id   INTEGER       NOT NULL,           -- supplier code (public.supplier_products.id; other schema, no FK)
  user_id      BIGINT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  author_name  TEXT          CONSTRAINT site_reviews_author_length CHECK (char_length(author_name) <= 40),
  rating       SMALLINT      NOT NULL CONSTRAINT site_reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
  body         TEXT          NOT NULL CONSTRAINT site_reviews_body_length CHECK (char_length(body) BETWEEN 10 AND 1000),
  status       review_status NOT NULL DEFAULT 'pending',
  ip           INET,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  moderated_at TIMESTAMPTZ,
  moderated_by BIGINT        REFERENCES users (id) ON DELETE SET NULL
);
-- product page: approved reviews of one product, newest first
CREATE INDEX site_reviews_product_idx ON site_reviews (product_id, created_at DESC) WHERE status = 'approved';
-- rate limiting ("reviews by this user in the last hour/day") and the moderation queue
CREATE INDEX site_reviews_user_created_idx ON site_reviews (user_id, created_at DESC);
CREATE INDEX site_reviews_pending_idx ON site_reviews (created_at) WHERE status = 'pending';
-- one review waiting for moderation per user and product
CREATE UNIQUE INDEX site_reviews_one_pending ON site_reviews (user_id, product_id) WHERE status = 'pending';

-- Down Migration
DROP TABLE site_reviews;
DROP TYPE review_status;
