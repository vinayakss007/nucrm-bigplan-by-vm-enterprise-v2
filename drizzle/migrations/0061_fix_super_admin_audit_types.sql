-- Migration: Fix superAdminAuditLogs column types
-- Convert text columns to proper uuid types
-- Drop existing CHECK constraints first (they reference text format)

-- Drop CHECK constraints from 0057
ALTER TABLE super_admin_audit_logs DROP CONSTRAINT IF EXISTS chk_super_admin_audit_logs_admin_id_uuid;
ALTER TABLE super_admin_audit_logs DROP CONSTRAINT IF EXISTS chk_super_admin_audit_logs_target_id_uuid;
ALTER TABLE super_admin_audit_logs DROP CONSTRAINT IF EXISTS chk_super_admin_audit_logs_tenant_id_uuid;

-- Convert id from text to uuid
ALTER TABLE super_admin_audit_logs ALTER COLUMN id TYPE uuid USING id::uuid;

-- Convert admin_id from text to uuid
ALTER TABLE super_admin_audit_logs ALTER COLUMN admin_id TYPE uuid USING admin_id::uuid;

-- Convert target_id from text to uuid
ALTER TABLE super_admin_audit_logs ALTER COLUMN target_id TYPE uuid USING target_id::uuid;

-- Add hash columns (defined in schema but missing from original migration)
ALTER TABLE super_admin_audit_logs ADD COLUMN IF NOT EXISTS previous_hash text;
ALTER TABLE super_admin_audit_logs ADD COLUMN IF NOT EXISTS hash text NOT NULL DEFAULT '';
