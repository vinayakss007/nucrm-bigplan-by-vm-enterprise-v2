-- Migration: 0053_text_length_limits
--
-- Adds CHECK constraints on critical text columns to enforce maximum length
-- at the DB level. Prevents unbounded storage from integration payloads.

-- contacts
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_first_name_len CHECK (first_name IS NULL OR length(first_name) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_last_name_len CHECK (last_name IS NULL OR length(last_name) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_email_len CHECK (email IS NULL OR length(email) <= 255);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_phone_len CHECK (phone IS NULL OR length(phone) <= 50);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_website_len CHECK (website IS NULL OR length(website) <= 500);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_address_len CHECK (address IS NULL OR length(address) <= 500);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_notes_len CHECK (notes IS NULL OR length(notes) <= 5000);

-- leads
ALTER TABLE leads ADD CONSTRAINT chk_leads_first_name_len CHECK (first_name IS NULL OR length(first_name) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_last_name_len CHECK (last_name IS NULL OR length(last_name) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_email_len CHECK (email IS NULL OR length(email) <= 255);
ALTER TABLE leads ADD CONSTRAINT chk_leads_phone_len CHECK (phone IS NULL OR length(phone) <= 50);
ALTER TABLE leads ADD CONSTRAINT chk_leads_title_len CHECK (title IS NULL OR length(title) <= 200);
ALTER TABLE leads ADD CONSTRAINT chk_leads_website_len CHECK (website IS NULL OR length(website) <= 500);
ALTER TABLE leads ADD CONSTRAINT chk_leads_address_len CHECK (address IS NULL OR length(address) <= 500);

-- deals
ALTER TABLE deals ADD CONSTRAINT chk_deals_title_len CHECK (title IS NULL OR length(title) <= 200);

-- tasks
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_title_len CHECK (title IS NULL OR length(title) <= 200);
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_description_len CHECK (description IS NULL OR length(description) <= 5000);

-- invoices
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_title_len CHECK (title IS NULL OR length(title) <= 200);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_notes_len CHECK (notes IS NULL OR length(notes) <= 5000);

-- quotes
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_title_len CHECK (title IS NULL OR length(title) <= 200);
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_notes_len CHECK (notes IS NULL OR length(notes) <= 5000);

-- orders
ALTER TABLE orders ADD CONSTRAINT chk_orders_title_len CHECK (title IS NULL OR length(title) <= 200);
ALTER TABLE orders ADD CONSTRAINT chk_orders_notes_len CHECK (notes IS NULL OR length(notes) <= 5000);
