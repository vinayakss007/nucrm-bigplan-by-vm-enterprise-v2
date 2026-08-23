-- Down Migration: Remove tenantId from 4 tables

-- 1. Remove tenant_id from price_book_entries
DROP INDEX IF EXISTS idx_price_book_entries_tenant;
ALTER TABLE price_book_entries DROP COLUMN IF EXISTS tenant_id;

-- 2. Remove tenant_id from pipeline_stages
DROP INDEX IF EXISTS idx_pipeline_stages_tenant;
ALTER TABLE pipeline_stages DROP COLUMN IF EXISTS tenant_id;

-- 3. Remove tenant_id from contact_emails
DROP INDEX IF EXISTS idx_contact_emails_tenant;
ALTER TABLE contact_emails DROP COLUMN IF EXISTS tenant_id;

-- 4. Remove tenant_id from hierarchy_permissions
DROP INDEX IF EXISTS idx_hierarchy_permissions_tenant;
ALTER TABLE hierarchy_permissions DROP COLUMN IF EXISTS tenant_id;
