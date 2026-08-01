-- Rollback 0009_audit_hash_chain: Remove hash chain columns
-- WARNING: This destroys the integrity chain. Only use if absolutely necessary.
DROP INDEX IF EXISTS idx_audit_logs_tenant_created;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS hash;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS previous_hash;
ALTER TABLE super_admin_audit_logs DROP COLUMN IF EXISTS hash;
ALTER TABLE super_admin_audit_logs DROP COLUMN IF EXISTS previous_hash;
