-- 0102: ai_activity.action must accept every action the AI features record.
--
-- chk_ai_activity_action was added in 0050 with six values:
-- 'draft', 'lead_scoring', 'predict_deal', 'enrich_contact', 'suggest_followup',
-- 'summarize'. Five AI call sites write action names that are not in that list:
--
--   app/api/tenant/ai/insights/route.ts:151      action: 'insights'
--   app/api/tenant/ai/email-draft/route.ts:125   action: 'email_draft'
--   lib/ai/auto-followup.ts:154                  action: 'auto_followup'
--   lib/ai/scoring.ts:69                         action: 'score_lead'
--   lib/ai/sentiment.ts:47                       action: 'sentiment_analysis'
--
-- The write goes through logActivity() in lib/ai/gateway.ts, which until now
-- wrapped it in `catch { console.warn(...) }`. A check_violation was therefore
-- invisible: no error_logs row, no Sentry event, no failed request — the AI
-- usage log just stayed empty while five features kept "recording" usage.
-- `ai_activity` holds zero rows across pre-prod; the usage panel has never had
-- data to show. That gateway handler is now logError() instead of console.warn,
-- so this class of failure surfaces if it ever happens again.
--
-- Why widen rather than rename the five call sites: the existing six values are
-- reachable from app/api/tenant/ai/route.ts, whose activityActionFor() maps the
-- gateway's 'draft_email'/'score_lead' labels onto 'draft'/'lead_scoring' — so
-- 'lead_scoring' is what the UI's score action already writes, while
-- lib/ai/scoring.ts writes 'score_lead' directly. Both spellings are real and
-- both are kept; collapsing them is a behaviour change to five features and
-- historical rows, not a constraint fix, and was explicitly declined in favour
-- of widening with no renames.
--
-- The result is the union of both vocabularies, so no existing row can violate
-- it (there are none) and scripts/check-constraint-vocab.mts now pins the two
-- sides together.
--
-- APPLIED to pre-prod on 2026-10-02 (approved: "Apply it + batch others"), after verification on nucrm_test.
ALTER TABLE "ai_activity" DROP CONSTRAINT IF EXISTS "chk_ai_activity_action";
--> statement-breakpoint
ALTER TABLE "ai_activity" ADD CONSTRAINT "chk_ai_activity_action" CHECK (
  "action" IN (
    'draft', 'lead_scoring', 'predict_deal',
    'enrich_contact', 'suggest_followup', 'summarize',
    'insights',
    'email_draft',
    'auto_followup',
    'score_lead',
    'sentiment_analysis'
  )
);
