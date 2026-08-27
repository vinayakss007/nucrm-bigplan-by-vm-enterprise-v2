-- Revert 0070.
ALTER TABLE support_tickets DROP COLUMN IF EXISTS first_response_at;
ALTER TABLE support_tickets DROP COLUMN IF EXISTS sla_policy_id;
