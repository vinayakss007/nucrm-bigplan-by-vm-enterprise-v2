-- Migration 0009: Add cryptographic hash chain to audit_logs
-- Purpose: Ensure audit log integrity with SHA-256 hash chain for compliance

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash TEXT;

-- Index for hash chain verification queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);

-- Comment documenting the hash chain mechanism
COMMENT ON COLUMN audit_logs.previous_hash IS 'SHA-256 hash of the previous audit log entry (null for first entry per tenant)';
COMMENT ON COLUMN audit_logs.hash IS 'SHA-256 hash of this entry''s data + previous_hash, forming an immutable chain';

-- Also add hash chain to super_admin_audit_logs
ALTER TABLE super_admin_audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT;
ALTER TABLE super_admin_audit_logs ADD COLUMN IF NOT EXISTS hash TEXT;

COMMENT ON COLUMN super_admin_audit_logs.previous_hash IS 'SHA-256 hash of the previous super admin audit entry (null for first entry)';
COMMENT ON COLUMN super_admin_audit_logs.hash IS 'SHA-256 hash of this entry''s data + previous_hash, forming an immutable chain';
