CREATE TABLE IF NOT EXISTS "lead_warming_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "event_type" text NOT NULL DEFAULT 'festival',
  "recurrence" text NOT NULL DEFAULT 'yearly',
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
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_tenant" ON "lead_warming_events" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_type" ON "lead_warming_events" ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_month_day" ON "lead_warming_events" ("event_month", "event_day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_events_active" ON "lead_warming_events" ("is_active") WHERE "is_active" = true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_warming_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'active',
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
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_campaigns_tenant" ON "lead_warming_campaigns" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_campaigns_status" ON "lead_warming_campaigns" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_campaigns_active" ON "lead_warming_campaigns" ("status") WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_warming_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "campaign_id" uuid NOT NULL REFERENCES "lead_warming_campaigns"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "event_id" uuid REFERENCES "lead_warming_events"("id") ON DELETE SET NULL,
  "channel" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "template_used" text,
  "ai_generated" boolean DEFAULT false,
  "ai_model" text,
  "ai_prompt_used" text,
  "status" text NOT NULL DEFAULT 'pending',
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "error_message" text,
  "opened_at" timestamp with time zone,
  "clicked_at" timestamp with time zone,
  "event_name" text,
  "personalized_for" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_messages_tenant" ON "lead_warming_messages" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_campaign" ON "lead_warming_messages" ("campaign_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_contact" ON "lead_warming_messages" ("contact_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_status" ON "lead_warming_messages" ("status", "sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_msg_channel" ON "lead_warming_messages" ("tenant_id", "channel", "sent_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_warming_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "message_id" uuid NOT NULL REFERENCES "lead_warming_messages"("id") ON DELETE CASCADE,
  "campaign_id" uuid REFERENCES "lead_warming_campaigns"("id") ON DELETE SET NULL,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
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
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_tenant" ON "lead_warming_replies" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_message" ON "lead_warming_replies" ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_contact" ON "lead_warming_replies" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_intent" ON "lead_warming_replies" ("tenant_id", "intent");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_unanalyzed" ON "lead_warming_replies" ("ai_analyzed") WHERE "ai_analyzed" = false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_replies_positive" ON "lead_warming_replies" ("tenant_id", "intent") WHERE "intent" = 'interested';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_warming_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "campaign_id" uuid NOT NULL REFERENCES "lead_warming_campaigns"("id") ON DELETE CASCADE,
  "last_message_at" timestamp with time zone,
  "next_eligible_at" timestamp with time zone,
  "messages_this_month" integer DEFAULT 0,
  "total_messages" integer DEFAULT 0,
  "total_replies" integer DEFAULT 0,
  "preferred_channel" text,
  "opted_out" boolean DEFAULT false,
  "opted_out_at" timestamp with time zone,
  "opt_out_reason" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_lead_warming_sched_unique" ON "lead_warming_schedule" ("contact_id", "campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_schedule_tenant" ON "lead_warming_schedule" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lead_warming_sched_eligible" ON "lead_warming_schedule" ("next_eligible_at") WHERE "opted_out" = false;
