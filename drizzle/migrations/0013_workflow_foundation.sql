-- Migration 0010: Workflow foundation
-- Purpose:
--   1. Add leads.contact_id (one contact, many leads model), leads.lead_oid, leads.product_id
--   2. Backfill leads.contact_id from leads.converted_contact_id where present
--   3. Create lead_offers (track what the client was offered per lead)
--   4. Create ai_providers (super-admin allow-list) + tenant_ai_credentials (per-tenant BYO key)
-- Safe properties: additive only, idempotent (IF NOT EXISTS), no destructive ops.

-- ── 1. LEADS additions ────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_oid TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT;

-- Backfill contact_id from the legacy converted_contact_id wherever a lead is already
-- linked to a contact via the old conversion path. Idempotent: only updates rows
-- where contact_id is still null AND converted_contact_id is set.
UPDATE leads
   SET contact_id = converted_contact_id
 WHERE contact_id IS NULL
   AND converted_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact         ON leads (contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_oid      ON leads (tenant_id, lead_oid);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_product  ON leads (tenant_id, product_id);

COMMENT ON COLUMN leads.contact_id IS
  'The person this lead is linked to. One contact can have many leads. Set at intake; convert no longer creates the contact.';
COMMENT ON COLUMN leads.lead_oid IS
  'Human-readable per-tenant lead identifier, e.g. LD-2025-001.';
COMMENT ON COLUMN leads.product_id IS
  'Product entry the lead came in through (matches a key in lib/products/registry.ts).';

-- ── 2-4. LEAD_OFFERS / AI PROVIDERS / TENANT AI CREDENTIALS ──────────────────
-- dedup: lead_offers + ai_providers + tenant_ai_credentials (created, commented,
-- and seeded by 0018_workflow_foundation_legacy — run there, not here).
