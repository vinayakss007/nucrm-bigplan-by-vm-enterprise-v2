-- Down Migration: 0045_check_constraints
-- Removes the CHECK constraints added by 0045

ALTER TABLE deals DROP CONSTRAINT IF EXISTS chk_deals_amount_non_negative;
ALTER TABLE deals DROP CONSTRAINT IF EXISTS chk_deals_probability_range;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS chk_contacts_email_format;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_score_range;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS chk_invoices_total_non_negative;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS chk_quotes_amount_non_negative;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_total_non_negative;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_priority_valid;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status_valid;
