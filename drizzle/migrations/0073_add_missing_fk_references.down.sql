-- Revert 0073: drop the two FK constraints added by the up migration.
ALTER TABLE "selective_restore_logs" DROP CONSTRAINT IF EXISTS "selective_restore_logs_backup_id_super_admin_backups_id_fk";
ALTER TABLE "api_key_usage_infra" DROP CONSTRAINT IF EXISTS "api_key_usage_infra_api_key_id_api_keys_id_fk";
