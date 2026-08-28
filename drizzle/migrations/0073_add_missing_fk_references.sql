-- 0073: add the two genuinely-missing foreign key references from issue #1314.
--
--   1. selective_restore_logs.backup_id -> super_admin_backups(id) ON DELETE SET NULL
--   2. api_key_usage_infra.api_key_id   -> api_keys(id)            ON DELETE CASCADE
--
-- All other #1314 columns are already constrained on main; this migration is
-- limited to exactly these two columns. Adding a FK to an existing table fails
-- if orphan rows exist, so each block first cleans orphans (following the
-- style of 0071_schema_drift_backfill.sql) and then adds the constraint inside
-- an idempotent guarded DO-block (following 0020_add_fk_references.sql), using
-- the exact Drizzle default constraint names so schema and DB agree.

-- ── 1. selective_restore_logs.backup_id -> super_admin_backups(id) ────────────
-- A restore log is an audit record that must survive deletion of its backup, so
-- the column is made nullable and the FK uses ON DELETE SET NULL. Orphaned
-- backup_id values (no matching super_admin_backups row) are nulled out rather
-- than deleted to preserve the audit trail.
ALTER TABLE selective_restore_logs ALTER COLUMN backup_id DROP NOT NULL;

UPDATE selective_restore_logs
  SET backup_id = NULL
  WHERE backup_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM super_admin_backups s WHERE s.id = selective_restore_logs.backup_id
    );

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'selective_restore_logs') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'selective_restore_logs_backup_id_super_admin_backups_id_fk') THEN
      ALTER TABLE "selective_restore_logs" ADD CONSTRAINT "selective_restore_logs_backup_id_super_admin_backups_id_fk"
        FOREIGN KEY ("backup_id") REFERENCES "super_admin_backups"("id")
        ON DELETE SET NULL;
      END IF;
    END IF;
  END;
$$;

-- ── 2. api_key_usage_infra.api_key_id -> api_keys(id) ─────────────────────────
-- Usage rows are meaningless without their key and cascade with it, so orphaned
-- rows (no matching api_keys row) are deleted and the FK uses ON DELETE CASCADE,
-- matching apiKeyUsage.apiKeyId in core.ts and comm.ts.
DELETE FROM api_key_usage_infra
  WHERE api_key_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM api_keys k WHERE k.id = api_key_usage_infra.api_key_id
    );

DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'api_key_usage_infra') THEN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_key_usage_infra_api_key_id_api_keys_id_fk') THEN
      ALTER TABLE "api_key_usage_infra" ADD CONSTRAINT "api_key_usage_infra_api_key_id_api_keys_id_fk"
        FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
        ON DELETE CASCADE;
      END IF;
    END IF;
  END;
$$;
