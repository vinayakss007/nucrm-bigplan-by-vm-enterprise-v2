-- Down Migration: 0067_ticket_portal_token
-- Removes the portal token column added for ticket portal auth (#1101)

DROP INDEX IF EXISTS idx_support_tickets_portal_token;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS portal_token;
