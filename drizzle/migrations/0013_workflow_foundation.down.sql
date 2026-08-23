-- Down Migration: 0013_workflow_foundation
DROP INDEX IF EXISTS idx_leads_contact;
DROP INDEX IF EXISTS idx_leads_tenant_oid;
DROP INDEX IF EXISTS idx_leads_tenant_product;
ALTER TABLE leads DROP COLUMN IF EXISTS contact_id;

DROP TABLE IF EXISTS tenant_ai_credentials;
DROP TABLE IF EXISTS ai_providers;
DROP TABLE IF EXISTS lead_offers;
