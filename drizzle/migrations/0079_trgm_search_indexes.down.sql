-- Revert 0078.
DROP INDEX IF EXISTS idx_contacts_first_name_trgm;
DROP INDEX IF EXISTS idx_contacts_last_name_trgm;
DROP INDEX IF EXISTS idx_contacts_email_trgm;
DROP INDEX IF EXISTS idx_contacts_phone_trgm;
DROP INDEX IF EXISTS idx_leads_first_name_trgm;
DROP INDEX IF EXISTS idx_leads_last_name_trgm;
DROP INDEX IF EXISTS idx_leads_email_trgm;
DROP INDEX IF EXISTS idx_leads_phone_trgm;
DROP INDEX IF EXISTS idx_companies_name_trgm;
DROP INDEX IF EXISTS idx_deals_title_trgm;
