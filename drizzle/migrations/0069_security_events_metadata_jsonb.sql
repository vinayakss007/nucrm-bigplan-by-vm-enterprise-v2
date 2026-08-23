-- 0069: security_events.metadata text -> jsonb (#1317)
--       usage_alerts tenant isolation: add tenant_id (#1315)

-- Issue #1317: metadata was stored as text; convert existing rows to jsonb.
ALTER TABLE security_events ALTER COLUMN metadata TYPE jsonb USING metadata::jsonb;

-- Issue #1315: usage_alerts had no tenant_id column (breaks tenant isolation
-- and tenant data export, which already filters on tenant_id).
ALTER TABLE usage_alerts ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE cascade;

-- Backfill tenant-scoped alerts from their target_id; drop orphaned rows
-- (platform alerts with no owning tenant) so the column can be NOT NULL.
UPDATE usage_alerts SET tenant_id = target_id
 WHERE tenant_id IS NULL AND target_type = 'tenant'
   AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = usage_alerts.target_id);
DELETE FROM usage_alerts WHERE tenant_id IS NULL;
ALTER TABLE usage_alerts ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_alerts_tenant ON usage_alerts(tenant_id);
