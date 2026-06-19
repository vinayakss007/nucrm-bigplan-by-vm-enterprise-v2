CREATE TABLE IF NOT EXISTS "sms_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "direction" text NOT NULL,
  "to" text NOT NULL,
  "from" text NOT NULL,
  "body" text NOT NULL,
  "template_id" uuid,
  "status" text NOT NULL DEFAULT 'queued',
  "twilio_sid" text,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sms_messages_tenant" ON "sms_messages" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sms_messages_contact" ON "sms_messages" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sms_messages_status" ON "sms_messages" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sms_messages_twilio_sid" ON "sms_messages" ("twilio_sid");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "variables" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sms_templates_tenant" ON "sms_templates" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sms_templates_active" ON "sms_templates" ("id") WHERE "deleted_at" IS NULL;
