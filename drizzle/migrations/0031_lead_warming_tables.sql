-- Migration: Lead Warming group tables

CREATE TABLE IF NOT EXISTS "lead_warming_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"target_filter" jsonb DEFAULT '{}'::jsonb,
	"event_ids" jsonb DEFAULT '[]'::jsonb,
	"include_birthdays" boolean DEFAULT true,
	"include_anniversaries" boolean DEFAULT false,
	"enable_email" boolean DEFAULT true,
	"enable_whatsapp" boolean DEFAULT true,
	"enable_sms" boolean DEFAULT false,
	"ai_generate_messages" boolean DEFAULT true,
	"ai_tone" text DEFAULT 'warm_professional',
	"ai_language" text DEFAULT 'en',
	"ai_analyze_replies" boolean DEFAULT true,
	"auto_respond_to_positive" boolean DEFAULT false,
	"notify_on_positive_intent" boolean DEFAULT true,
	"max_messages_per_contact_per_month" integer DEFAULT 4,
	"cooldown_days" integer DEFAULT 7,
	"total_sent" integer DEFAULT 0,
	"total_replies" integer DEFAULT 0,
	"total_positive_intent" integer DEFAULT 0,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "lead_warming_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'festival' NOT NULL,
	"recurrence" text DEFAULT 'yearly' NOT NULL,
	"event_month" integer,
	"event_day" integer,
	"event_date" timestamp with time zone,
	"send_days_before" integer DEFAULT 0,
	"send_hour" integer DEFAULT 9,
	"channels" jsonb DEFAULT '["email","whatsapp"]'::jsonb,
	"default_email_subject" text,
	"default_email_body" text,
	"default_whatsapp_template" text,
	"ai_prompt_hint" text,
	"is_active" boolean DEFAULT true,
	"is_system" boolean DEFAULT false,
	"region" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "lead_warming_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"event_id" uuid,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"template_used" text,
	"ai_generated" boolean DEFAULT false,
	"ai_model" text,
	"ai_prompt_used" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"error_message" text,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"event_name" text,
	"personalized_for" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "lead_warming_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"campaign_id" uuid,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"reply_content" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now(),
	"ai_analyzed" boolean DEFAULT false,
	"ai_analyzed_at" timestamp with time zone,
	"intent" text,
	"intent_confidence" integer,
	"sentiment" text,
	"sentiment_score" integer,
	"ai_summary" text,
	"ai_suggested_action" text,
	"ai_extracted_entities" jsonb DEFAULT '{}'::jsonb,
	"requires_follow_up" boolean DEFAULT false,
	"follow_up_created" boolean DEFAULT false,
	"follow_up_task_id" uuid,
	"owner_notified" boolean DEFAULT false,
	"notified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "lead_warming_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"next_eligible_at" timestamp with time zone,
	"messages_this_month" integer DEFAULT 0,
	"total_messages" integer DEFAULT 0,
	"total_replies" integer DEFAULT 0,
	"preferred_channel" text,
	"opted_out" boolean DEFAULT false,
	"opted_out_at" timestamp with time zone,
	"opt_out_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_campaigns_created_by_users_id_fk') THEN
    ALTER TABLE "lead_warming_campaigns" ADD CONSTRAINT "lead_warming_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "lead_warming_events" ADD CONSTRAINT "lead_warming_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_messages_campaign_id_lead_warming_campaigns_id_fk') THEN
    ALTER TABLE "lead_warming_messages" ADD CONSTRAINT "lead_warming_messages_campaign_id_lead_warming_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."lead_warming_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_messages_contact_id_contacts_id_fk') THEN
    ALTER TABLE "lead_warming_messages" ADD CONSTRAINT "lead_warming_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_messages_event_id_lead_warming_events_id_fk') THEN
    ALTER TABLE "lead_warming_messages" ADD CONSTRAINT "lead_warming_messages_event_id_lead_warming_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."lead_warming_events"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_replies_message_id_lead_warming_messages_id_fk') THEN
    ALTER TABLE "lead_warming_replies" ADD CONSTRAINT "lead_warming_replies_message_id_lead_warming_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."lead_warming_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_replies_campaign_id_lead_warming_campaigns_id_fk') THEN
    ALTER TABLE "lead_warming_replies" ADD CONSTRAINT "lead_warming_replies_campaign_id_lead_warming_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."lead_warming_campaigns"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_replies_contact_id_contacts_id_fk') THEN
    ALTER TABLE "lead_warming_replies" ADD CONSTRAINT "lead_warming_replies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_schedule_contact_id_contacts_id_fk') THEN
    ALTER TABLE "lead_warming_schedule" ADD CONSTRAINT "lead_warming_schedule_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_warming_schedule_campaign_id_lead_warming_campaigns_id_fk') THEN
    ALTER TABLE "lead_warming_schedule" ADD CONSTRAINT "lead_warming_schedule_campaign_id_lead_warming_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."lead_warming_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_lead_warming_campaigns_tenant" ON "lead_warming_campaigns" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_campaigns_status" ON "lead_warming_campaigns" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_campaigns_active" ON "lead_warming_campaigns" USING btree ("status") WHERE status = 'active';
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_tenant" ON "lead_warming_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_type" ON "lead_warming_events" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_month_day" ON "lead_warming_events" USING btree ("event_month","event_day");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_active" ON "lead_warming_events" USING btree ("is_active") WHERE is_active = true;
CREATE INDEX IF NOT EXISTS "idx_lead_warming_messages_tenant" ON "lead_warming_messages" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_campaign" ON "lead_warming_messages" USING btree ("campaign_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_contact" ON "lead_warming_messages" USING btree ("contact_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_status" ON "lead_warming_messages" USING btree ("status","sent_at");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_channel" ON "lead_warming_messages" USING btree ("tenant_id","channel","sent_at");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_tenant" ON "lead_warming_replies" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_message" ON "lead_warming_replies" USING btree ("message_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_contact" ON "lead_warming_replies" USING btree ("contact_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_intent" ON "lead_warming_replies" USING btree ("tenant_id","intent");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_unanalyzed" ON "lead_warming_replies" USING btree ("ai_analyzed") WHERE ai_analyzed = false;
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_positive" ON "lead_warming_replies" USING btree ("tenant_id","intent") WHERE intent = 'interested';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_lead_warming_sched_unique" ON "lead_warming_schedule" USING btree ("contact_id","campaign_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_schedule_tenant" ON "lead_warming_schedule" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lead_warming_sched_eligible" ON "lead_warming_schedule" USING btree ("next_eligible_at") WHERE opted_out = false;
