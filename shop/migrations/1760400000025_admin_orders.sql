-- Up Migration
-- Operator tools for orders (task J): the admin's private notes on an order. Append-only like the events and the ledger (the
-- trigger refuses UPDATE and DELETE); the customer's pages never read this table. The operator's other facts (the supplier
-- payment reference, a manual tracking code, the reasons) live in order_events, which already exists.
CREATE TABLE order_notes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   BIGINT      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  author_id  BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  body       TEXT        NOT NULL CONSTRAINT order_notes_body_length CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_notes_order_idx ON order_notes (order_id, id);
CREATE TRIGGER order_notes_append_only BEFORE UPDATE OR DELETE ON order_notes FOR EACH ROW EXECUTE FUNCTION append_only_guard();
-- the admin list sorts and filters by status and date
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC);

-- Down Migration
DROP INDEX orders_status_created_idx;
DROP TABLE order_notes;
