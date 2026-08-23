-- Down Migration: 0010_services_contacts_companies
DROP INDEX IF EXISTS idx_services_company;
DROP INDEX IF EXISTS idx_services_contact;
ALTER TABLE services DROP COLUMN IF EXISTS company_id;
ALTER TABLE services DROP COLUMN IF EXISTS contact_id;
