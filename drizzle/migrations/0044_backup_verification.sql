-- Migration ID: 0044_backup_verification
-- Name: Track automated backup restore verification
-- Dependencies: 0043_audit_logs_retain_actor

-- Adds columns to backup_records so /api/cron/backup-verify can record whether
-- the most recent backup was proved restorable — the difference between "a
-- backup exists" and "we can actually recover from it".

BEGIN;

ALTER TABLE backup_records ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;
ALTER TABLE backup_records ADD COLUMN IF NOT EXISTS verified_ok boolean;
ALTER TABLE backup_records ADD COLUMN IF NOT EXISTS verify_error text;

COMMIT;
