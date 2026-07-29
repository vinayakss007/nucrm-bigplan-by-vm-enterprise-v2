-- Rollback for 0045_lead_product_service_request
-- Kept in a separate file: drizzle's migrate() has no concept of a DOWN
-- section and would execute these statements as part of the forward
-- migration, undoing it immediately.
BEGIN;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_requested_product_id_fkey;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_requested_service_id_fkey;

ALTER TABLE leads DROP COLUMN IF EXISTS requested_product_id;
ALTER TABLE leads DROP COLUMN IF EXISTS requested_service_id;

COMMIT;
