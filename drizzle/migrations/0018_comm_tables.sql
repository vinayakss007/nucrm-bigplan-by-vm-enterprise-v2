-- Migration: Comm group tables (sms_messages, sms_templates, email_clicks, email_opens)

CREATE TABLE IF NOT EXISTS "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"direction" text NOT NULL,
	"to" text NOT NULL,
	"from" text NOT NULL,
	"body" text NOT NULL,
	"template_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"twilio_sid" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "sms_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "email_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"campaign_id" uuid,
	"email_id" uuid,
	"link_url" text NOT NULL,
	"clicked_at" timestamp with time zone DEFAULT now(),
	"ip_address" text
);

CREATE TABLE IF NOT EXISTS "email_opens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"campaign_id" uuid,
	"email_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now(),
	"ip_address" text,
	"user_agent" text
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_messages_contact_id_contacts_id_fk') THEN
    ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_clicks_contact_id_contacts_id_fk') THEN
    ALTER TABLE "email_clicks" ADD CONSTRAINT "email_clicks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_opens_contact_id_contacts_id_fk') THEN
    ALTER TABLE "email_opens" ADD CONSTRAINT "email_opens_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_sms_messages_tenant" ON "sms_messages" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sms_messages_contact" ON "sms_messages" USING btree ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_sms_messages_status" ON "sms_messages" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_sms_messages_twilio_sid" ON "sms_messages" USING btree ("twilio_sid");
CREATE INDEX IF NOT EXISTS "idx_sms_templates_tenant" ON "sms_templates" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sms_templates_active" ON "sms_templates" USING btree ("id") WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS "idx_email_clicks_tenant" ON "email_clicks" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_email_clicks_contact" ON "email_clicks" USING btree ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_email_clicks_campaign" ON "email_clicks" USING btree ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_email_opens_tenant" ON "email_opens" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_email_opens_contact" ON "email_opens" USING btree ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_email_opens_campaign" ON "email_opens" USING btree ("campaign_id");
