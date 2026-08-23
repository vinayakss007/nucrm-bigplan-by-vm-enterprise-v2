-- Add portal_token column to support_tickets for secure public access
-- Replaces spoofable x-portal-email header auth with opaque token validation

ALTER TABLE support_tickets ADD COLUMN portal_token text;

-- Backfill existing tickets with unique random tokens (32-char base64url)
UPDATE support_tickets SET portal_token = encode(gen_random_bytes(24), 'base64url');

-- Make the column NOT NULL after backfill
ALTER TABLE support_tickets ALTER COLUMN portal_token SET NOT NULL;

-- Add unique constraint and index
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_portal_token_unique UNIQUE (portal_token);
CREATE INDEX idx_tickets_portal_token ON support_tickets (portal_token);
