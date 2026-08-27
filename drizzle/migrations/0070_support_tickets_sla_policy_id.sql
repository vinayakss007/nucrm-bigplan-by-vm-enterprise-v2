-- 0070: add support_tickets SLA columns (schema drift fix)
--
-- drizzle/schema/support.ts declares two columns on support_tickets that no
-- migration ever created:
--   slaPolicyId     uuid('sla_policy_id')
--   firstResponseAt timestamp('first_response_at', { withTimezone: true })
-- Every query that touched them (seed-dev, the tickets/SLA features) failed at
-- runtime with `42703 column "..." of relation "support_tickets" does not exist`.
--
-- Both are declared as plain nullable columns (sla_policy_id has no
-- .references()), so this mirrors the schema exactly. IF NOT EXISTS keeps it a
-- no-op on databases provisioned via db:push/db:sync (already at live schema).
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_policy_id uuid;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_at timestamp with time zone;
