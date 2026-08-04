-- Migration 0057: UUID format validation on text columns storing UUIDs
-- super_admin_audit_logs has text columns that store UUIDs
-- Validates format: 8-4-4-4-12 hex digits

-- super_admin_audit_logs.admin_id
ALTER TABLE super_admin_audit_logs ADD CONSTRAINT chk_super_admin_audit_logs_admin_id_uuid
  CHECK (admin_id IS NULL OR admin_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- super_admin_audit_logs.target_id
ALTER TABLE super_admin_audit_logs ADD CONSTRAINT chk_super_admin_audit_logs_target_id_uuid
  CHECK (target_id IS NULL OR target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- super_admin_audit_logs.tenant_id
ALTER TABLE super_admin_audit_logs ADD CONSTRAINT chk_super_admin_audit_logs_tenant_id_uuid
  CHECK (tenant_id IS NULL OR tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
