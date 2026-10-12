-- Undo 0104: back to the five values 0097 left. Any integration row of type
-- sms/mailgun/sendgrid/openai makes this fail loudly rather than orphan a
-- tenant's saved provider configuration.
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "chk_integrations_type";
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "chk_integrations_type"
  CHECK ("type" IN ('google','outlook','zoom','slack','webhook'));
