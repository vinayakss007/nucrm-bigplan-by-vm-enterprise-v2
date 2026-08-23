-- Down Migration: Revert superAdminAuditLogs column types

-- Convert uuid columns back to text
ALTER TABLE super_admin_audit_logs ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE super_admin_audit_logs ALTER COLUMN admin_id TYPE text USING admin_id::text;
ALTER TABLE super_admin_audit_logs ALTER COLUMN target_id TYPE text USING target_id::text;

-- Re-add CHECK constraints
ALTER TABLE super_admin_audit_logs ADD CONSTRAINT chk_super_admin_audit_logs_admin_id_uuid
  CHECK (admin_id IS NULL OR admin_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

ALTER TABLE super_admin_audit_logs ADD CONSTRAINT chk_super_admin_audit_logs_target_id_uuid
  CHECK (target_id IS NULL OR target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

ALTER TABLE super_admin_audit_logs ADD CONSTRAINT chk_super_admin_audit_logs_tenant_id_uuid
  CHECK (tenant_id IS NULL OR tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Remove hash columns
ALTER TABLE super_admin_audit_logs DROP COLUMN IF EXISTS previous_hash;
ALTER TABLE super_admin_audit_logs DROP COLUMN IF EXISTS hash;
