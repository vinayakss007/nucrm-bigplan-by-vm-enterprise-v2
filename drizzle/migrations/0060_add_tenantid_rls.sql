-- Migration: Add tenantId to 4 tables for RLS compliance
-- Tables: price_book_entries, pipeline_stages, contact_emails, hierarchy_permissions

-- 1. Add tenant_id to price_book_entries
ALTER TABLE price_book_entries 
ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX idx_price_book_entries_tenant ON price_book_entries(tenant_id);

-- 2. Add tenant_id to pipeline_stages
ALTER TABLE pipeline_stages 
ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX idx_pipeline_stages_tenant ON pipeline_stages(tenant_id);

-- 3. Add tenant_id to contact_emails
ALTER TABLE contact_emails 
ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX idx_contact_emails_tenant ON contact_emails(tenant_id);

-- 4. Add tenant_id to hierarchy_permissions
ALTER TABLE hierarchy_permissions 
ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX idx_hierarchy_permissions_tenant ON hierarchy_permissions(tenant_id);
