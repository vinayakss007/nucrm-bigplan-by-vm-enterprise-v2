-- Undo 0097: back to the four OAuth providers only. Any row with type='webhook'
-- makes this fail loudly rather than silently deleting webhook configuration —
-- which is the correct outcome, since those rows are live customer webhooks.
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "chk_integrations_type";
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "chk_integrations_type"
  CHECK ("type" IN ('google','outlook','zoom','slack'));
