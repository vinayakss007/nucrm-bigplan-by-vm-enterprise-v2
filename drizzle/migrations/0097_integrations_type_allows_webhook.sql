-- 0097: integrations.type must accept 'webhook'.
--
-- The Webhooks settings surface stores outbound webhooks in `integrations`
-- (config->>'url', config->'events', config->>'secret', and webhook_queue
-- referencing integrations.id) and filters type='webhook' in six routes:
-- app/api/tenant/webhooks/{route,[id],[id]/test,logs}. chk_integrations_type was
-- added in 0050 when the table only ever held the four OAuth providers, so every
-- POST /api/tenant/webhooks fails with check_violation and the customer sees a
-- bare 500. The constraint is simply stale relative to how the table is used.
--
-- NOT APPLIED. Awaiting explicit approval: this is a schema change on a live
-- database. Run with `npm run db:migrate` once approved.
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "chk_integrations_type";
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "chk_integrations_type"
  CHECK ("type" IN ('google','outlook','zoom','slack','webhook'));
