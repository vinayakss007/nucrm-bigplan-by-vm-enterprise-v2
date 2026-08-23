-- Revert 0069.

DROP INDEX IF EXISTS idx_usage_alerts_tenant;
ALTER TABLE usage_alerts DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE security_events ALTER COLUMN metadata TYPE text USING metadata::text;
