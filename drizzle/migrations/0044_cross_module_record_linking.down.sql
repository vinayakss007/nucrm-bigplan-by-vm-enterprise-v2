-- Rollback for 0044_cross_module_record_linking
-- Kept in a separate file: drizzle's migrate() has no concept of a DOWN
-- section and would execute these statements as part of the forward
-- migration, undoing it immediately.
BEGIN;

DROP TABLE IF EXISTS record_links;

ALTER TABLE tasks           DROP CONSTRAINT IF EXISTS tasks_company_id_fkey;
ALTER TABLE tasks           DROP CONSTRAINT IF EXISTS tasks_lead_id_fkey;
ALTER TABLE tasks           DROP CONSTRAINT IF EXISTS tasks_ticket_id_fkey;
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_company_id_fkey;
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_deal_id_fkey;
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_lead_id_fkey;
ALTER TABLE activities      DROP CONSTRAINT IF EXISTS activities_lead_id_fkey;
ALTER TABLE quotes          DROP CONSTRAINT IF EXISTS quotes_company_id_fkey;
ALTER TABLE invoices        DROP CONSTRAINT IF EXISTS invoices_deal_id_fkey;

ALTER TABLE tasks           DROP COLUMN IF EXISTS company_id;
ALTER TABLE tasks           DROP COLUMN IF EXISTS lead_id;
ALTER TABLE tasks           DROP COLUMN IF EXISTS ticket_id;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS company_id;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS deal_id;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS lead_id;
ALTER TABLE activities      DROP COLUMN IF EXISTS lead_id;
ALTER TABLE quotes          DROP COLUMN IF EXISTS company_id;
ALTER TABLE invoices        DROP COLUMN IF EXISTS deal_id;

COMMIT;
