-- Undo 0101: back to the four values 0050 allowed. Rows of any other type make
-- this fail loudly instead of dropping live notifications — which is the correct
-- outcome, since those rows are the delivered alerts users depend on.
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "chk_notifications_type";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "chk_notifications_type"
  CHECK ("type" IN ('info','mention','deal_stage','deal_won'));
