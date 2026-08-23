-- Migration: Add missing indexes on hot query paths
-- Addresses issue #1375: Missing indexes causing full table scans

-- 1. tenants.status
CREATE INDEX idx_tenants_status ON tenants(status);

-- 2. quoteLineItems.tenantId
CREATE INDEX idx_quote_line_items_tenant ON quote_line_items(tenant_id);

-- 3. leadActivities.leadId
CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id);

-- 4. apiKeyUsage.tenantId/createdAt
CREATE INDEX idx_api_key_usage_tenant ON api_key_usage(tenant_id);
CREATE INDEX idx_api_key_usage_created ON api_key_usage(created_at);

-- 5. tenantHierarchy - already has indexes from hierarchy.ts, skip

-- 6. territories.tenantId/parentId
CREATE INDEX idx_territories_tenant ON territories(tenant_id);
CREATE INDEX idx_territories_parent ON territories(parent_id);

-- 7. pageViews - already has tenantIdx and visitorIdx from visitors.ts, skip

-- 8. segmentMembers.entityId
CREATE INDEX idx_segment_members_entity ON segment_members(entity_id);
