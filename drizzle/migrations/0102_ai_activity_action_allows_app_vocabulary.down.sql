-- Undo 0102: back to the six values 0050 allowed. Any row carrying one of the
-- five added actions makes this fail loudly instead of deleting recorded AI
-- usage, which is the correct outcome for an audit-ish table.
ALTER TABLE "ai_activity" DROP CONSTRAINT IF EXISTS "chk_ai_activity_action";
--> statement-breakpoint
ALTER TABLE "ai_activity" ADD CONSTRAINT "chk_ai_activity_action"
  CHECK ("action" IN ('draft','lead_scoring','predict_deal','enrich_contact','suggest_followup','summarize'));
