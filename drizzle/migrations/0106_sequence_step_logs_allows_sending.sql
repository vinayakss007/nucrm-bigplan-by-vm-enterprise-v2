-- 0106: sequence_step_logs.status must accept 'sending' (#2223).
--
-- The process-sequences cron now uses an outbox claim: the claim transaction
-- flips the due step log 'pending' → 'sending' and commits, SMTP runs OUTSIDE
-- any transaction, and a second short transaction confirms 'sent' or reverts
-- to 'pending'. A crash between commit and confirm leaves a durable 'sending'
-- row that the next run finalizes WITHOUT resending — that is what stops the
-- duplicate-email storm the old in-tx send caused.
--
-- chk_sequence_step_logs_status (0050) only allows pending/sent/skipped/
-- failed/cancelled, so every claim UPDATE would die with check_violation, the
-- tx would roll back and no sequence email would ever leave. Widening the
-- constraint adds a value; no existing row can violate the new check.
ALTER TABLE "sequence_step_logs" DROP CONSTRAINT IF EXISTS "chk_sequence_step_logs_status";
--> statement-breakpoint
ALTER TABLE "sequence_step_logs" ADD CONSTRAINT "chk_sequence_step_logs_status"
  CHECK ("status" IN ('pending','sending','sent','skipped','failed','cancelled'));
