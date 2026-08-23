-- Down Migration: Remove added indexes

DROP INDEX IF EXISTS idx_tenants_status;
DROP INDEX IF EXISTS idx_quote_line_items_tenant;
DROP INDEX IF EXISTS idx_lead_activities_lead;
DROP INDEX IF EXISTS idx_api_key_usage_tenant;
DROP INDEX IF EXISTS idx_api_key_usage_created;
DROP INDEX IF EXISTS idx_territories_tenant;
DROP INDEX IF EXISTS idx_territories_parent;
DROP INDEX IF EXISTS idx_segment_members_entity;
