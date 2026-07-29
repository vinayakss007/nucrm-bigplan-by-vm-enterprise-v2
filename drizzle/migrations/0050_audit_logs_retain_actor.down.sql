-- Rollback for 0050_audit_logs_retain_actor
--
-- WARNING: restoring this FK re-introduces both defects — deleting a user will
-- erase attribution from every audit entry, and (while 0048 is applied) user
-- deletion will fail outright because ON DELETE SET NULL fires the blocked UPDATE
-- trigger. Roll back 0048 as well if you need user deletion to work.
BEGIN;

DROP INDEX IF EXISTS idx_audit_logs_user;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'audit_logs')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint con
       JOIN pg_class child ON child.oid = con.conrelid
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
       WHERE con.contype = 'f' AND child.relname = 'audit_logs' AND att.attname = 'user_id'
     ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT audit_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
