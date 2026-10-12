-- Undo 0103: back to the four values 0050 allowed. Any scheduled report of type
-- deals/tasks/companies makes this fail loudly rather than silently disabling a
-- customer's recurring delivery.
ALTER TABLE "scheduled_reports" DROP CONSTRAINT IF EXISTS "chk_scheduled_reports_type";
--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "chk_scheduled_reports_type"
  CHECK ("type" IN ('pipeline','revenue','contacts','performance'));
