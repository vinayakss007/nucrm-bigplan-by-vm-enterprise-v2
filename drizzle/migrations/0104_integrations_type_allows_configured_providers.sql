-- 0104: integrations.type must accept the providers the app ships and reads.
--
-- chk_integrations_type currently allows google, outlook, zoom, slack, webhook
-- (webhook added by 0097 for the same reason as this change). Four more types
-- have real code behind them:
--
--   mailgun    — lib/integrations/providers/mailgun.ts (id: 'mailgun')
--   sendgrid   — lib/integrations/providers/sendgrid.ts, and
--                lib/email/router.ts routes sends through a sendgrid provider key
--   openai     — lib/integrations/providers/openai.ts
--
-- These three are wired into lib/integrations/registry.ts, which
-- POST /api/tenant/plugin-engine reads via getProviderDef() and then writes
-- straight into this column: app/api/tenant/plugin-engine/route.ts:84 inserts
-- `type: body.provider_id`. So connecting any registered mailgun/sendgrid/openai
-- provider fails with check_violation and the customer gets a bare 500 from the
-- plugin-engine surface — the provider list and the constraint disagree.
--
--   sms        — read by lib/automation/engine.ts:393, which looks an SMS
--                integration up with eq(integrations.type, 'sms') for the
--                messaging automation action. While the constraint rejects
--                'sms' that lookup can never match, so the automation has no
--                reachable transport no matter what a tenant configures.
--
-- The alternative — dropping the provider definitions — would remove working
-- email/AI transport code to satisfy a stale constraint, which is the same
-- mistake 0097 corrected for 'webhook'.
--
-- Widening only adds values, so no existing row can violate the new constraint.
--
-- APPLIED to pre-prod on 2026-10-02 (approved: "Apply it + batch others"), after verification on nucrm_test.
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "chk_integrations_type";
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "chk_integrations_type" CHECK (
  "type" IN (
    'google', 'outlook', 'zoom', 'slack', 'webhook',
    'sms',
    'mailgun',
    'sendgrid',
    'openai'
  )
);
