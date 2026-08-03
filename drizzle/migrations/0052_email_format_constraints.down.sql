-- Migration: 0052_email_format_constraints (down)
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS chk_contacts_email_format;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS chk_leads_email_format;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_email_format;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS chk_invitations_email_format;
ALTER TABLE portal_clients DROP CONSTRAINT IF EXISTS chk_portal_clients_email_format;
