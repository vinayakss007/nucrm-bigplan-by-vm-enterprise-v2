-- Rollback for 0051_backup_verification
BEGIN;
ALTER TABLE backup_records DROP COLUMN IF EXISTS last_verified_at;
ALTER TABLE backup_records DROP COLUMN IF EXISTS verified_ok;
ALTER TABLE backup_records DROP COLUMN IF EXISTS verify_error;
COMMIT;
