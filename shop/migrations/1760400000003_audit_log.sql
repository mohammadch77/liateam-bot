-- Up Migration
-- Append-only record of sensitive actions (sign-in, role changes, admin edits).
CREATE TABLE audit_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL for system actions. RESTRICT: an actor with audit history can never be hard-deleted.
  actor_user_id BIGINT      REFERENCES users (id) ON DELETE RESTRICT,
  action        TEXT        NOT NULL CONSTRAINT audit_log_action_format CHECK (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  entity_type   TEXT        NOT NULL CONSTRAINT audit_log_entity_type_format CHECK (entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  entity_id     TEXT,
  meta          JSONB       NOT NULL DEFAULT '{}' CONSTRAINT audit_log_meta_object CHECK (jsonb_typeof(meta) = 'object'),
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_created_idx ON audit_log (actor_user_id, created_at DESC);

-- Evidence must not be rewritten: block UPDATE/DELETE for every role, whatever its table privileges.
CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Down Migration
DROP TABLE audit_log;
DROP FUNCTION audit_log_immutable();
