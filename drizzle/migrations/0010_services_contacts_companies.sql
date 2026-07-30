-- Add contact_id and company_id to services table
ALTER TABLE services 
ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_services_contact ON services(contact_id);
CREATE INDEX IF NOT EXISTS idx_services_company ON services(company_id);

-- DOWN
DROP INDEX IF EXISTS idx_services_company;
DROP INDEX IF EXISTS idx_services_contact;
ALTER TABLE services DROP COLUMN IF EXISTS company_id;
ALTER TABLE services DROP COLUMN IF EXISTS contact_id;