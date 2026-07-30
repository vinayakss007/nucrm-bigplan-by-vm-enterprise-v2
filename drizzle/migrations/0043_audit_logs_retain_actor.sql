-- Migration ID: 0043_audit_logs_retain_actor
-- Name: audit_logs.user_id retains the actor when a user is deleted
-- Dependencies: 0042_audit_log_immutability

-- WHY THIS EXISTS
-- ---------------
-- Two problems, one fix.
--
-- 1. AUDIT INTEGRITY. `audit_logs.user_id` was declared ON DELETE SET NULL, so
--    deleting a user erased who performed every action they had ever taken. That
--    is backwards: retaining the actor is the entire purpose of an audit log, and
--    "the user was deleted" is precisely when you most need to know what they did.
--    Deleting a user became a way to launder your own history.
--
-- 2. IT DEADLOCKED WITH 0048. ON DELETE SET NULL is implemented as an UPDATE on
--    the referencing table, which fires row-level UPDATE triggers. 0048 refuses
--    every UPDATE on audit_logs, so user deletion failed outright:
--
--      ERROR: audit log entries are immutable: UPDATE on audit_logs is not permitted
--      CONTEXT: SQL statement "UPDATE ONLY "public"."audit_logs" SET "user_id" = NULL ..."
--
--    Reproduced on PG16. Left unfixed, no user could ever be deleted.
--
-- FIX: drop the foreign key and keep `user_id` as a plain uuid. The actor id
-- survives the user record, and user deletion no longer touches audit_logs at all.
-- This is already the established pattern for the super-admin trail, where
-- `super_admin_audit_logs.admin_id` is a plain text column with no FK.
--
-- REJECTED ALTERNATIVES
--  - Teach 0048 to allow an UPDATE that only nulls user_id: it would carve a hole
--    in immutability for the exact operation that destroys attribution.
--  - ON DELETE RESTRICT: makes user deletion impossible instead of merely broken,
--    and blocks lawful erasure.
--  - Keep SET NULL and drop the 0048 UPDATE guard: trades a tamper-proof audit log
--    for a convenience.

-- UP Migration
BEGIN;

DO $$
DECLARE
  con_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    RAISE NOTICE 'audit_logs absent, skipping';
    RETURN;
  END IF;

  -- Find the FK on audit_logs.user_id whatever it is named.
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class child ON child.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND child.relname = 'audit_logs'
    AND att.attname = 'user_id'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', con_name);
    RAISE NOTICE 'dropped FK % on audit_logs.user_id; actor id is now retained', con_name;
  ELSE
    RAISE NOTICE 'audit_logs.user_id already has no FK';
  END IF;
END $$;

COMMENT ON COLUMN audit_logs.user_id IS
  'Actor user id. Intentionally NOT a foreign key: the actor must survive deletion of the user record, and ON DELETE SET NULL would both destroy attribution and violate the append-only triggers from 0048.';

-- The column is queried when filtering an actor's history; without the FK there is
-- no implicit index, so add one.
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(tenant_id, user_id)
  WHERE user_id IS NOT NULL;

COMMIT;
