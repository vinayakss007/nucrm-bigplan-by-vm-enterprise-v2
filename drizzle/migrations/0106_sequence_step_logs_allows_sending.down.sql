-- Undo 0106: back to the five values 0050 left. Any step log still in
-- 'sending' makes this fail loudly rather than silently stranding an
-- in-flight sequence email.
ALTER TABLE "sequence_step_logs" DROP CONSTRAINT IF EXISTS "chk_sequence_step_logs_status";
--> statement-breakpoint
ALTER TABLE "sequence_step_logs" ADD CONSTRAINT "chk_sequence_step_logs_status"
  CHECK ("status" IN ('pending','sent','skipped','failed','cancelled'));
