-- Fix: sla_breaches.policy_id is text but sla_policies.id is UUID
-- Cast existing text values to uuid (will fail if any non-uuid text exists)
ALTER TABLE sla_breaches
  ALTER COLUMN policy_id TYPE uuid USING policy_id::uuid;
