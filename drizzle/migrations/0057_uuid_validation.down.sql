-- Migration 0057 down: Remove UUID format validation

ALTER TABLE super_admin_audit_logs DROP CONSTRAINT IF EXISTS chk_super_admin_audit_logs_admin_id_uuid;
ALTER TABLE super_admin_audit_logs DROP CONSTRAINT IF EXISTS chk_super_admin_audit_logs_target_id_uuid;
ALTER TABLE super_admin_audit_logs DROP CONSTRAINT IF EXISTS chk_super_admin_audit_logs_tenant_id_uuid;
