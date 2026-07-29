-- Migration: Create 4 missing tables (dunning_settings, dunning_attempts, csat_surveys, canned_responses)
-- Issue #219: Schema migration split

CREATE TABLE IF NOT EXISTS "dunning_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "max_retries" integer DEFAULT 3 NOT NULL,
  "retry_interval_days" integer DEFAULT 1 NOT NULL,
  "grace_period_days" integer DEFAULT 7 NOT NULL,
  "suspension_action" text DEFAULT 'downgrade' NOT NULL,
  "retry_schedule" jsonb DEFAULT '[1,3,7,14]'::jsonb,
  "email_notifications" boolean DEFAULT true,
  "webhook_notifications" boolean DEFAULT false,
  "is_active" boolean DEFAULT true,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "deleted_by" uuid,
  CONSTRAINT "dunning_settings_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dunning_settings_tenant" ON "dunning_settings" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dunning_settings_active" ON "dunning_settings" ("tenant_id", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dunning_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid,
  "attempt_number" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "executed_at" timestamp with time zone,
  "payment_amount" numeric(10, 2),
  "payment_currency" text DEFAULT 'usd',
  "stripe_invoice_id" text,
  "stripe_payment_intent_id" text,
  "error_message" text,
  "retry_count" integer DEFAULT 0,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "dunning_attempts_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade,
  CONSTRAINT "dunning_attempts_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dunning_attempts_tenant" ON "dunning_attempts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dunning_attempts_subscription" ON "dunning_attempts" ("subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dunning_attempts_status" ON "dunning_attempts" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dunning_attempts_scheduled" ON "dunning_attempts" ("scheduled_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "csat_surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "ticket_id" uuid NOT NULL,
  "contact_id" uuid,
  "score" integer,
  "comment" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "responded_at" timestamp with time zone,
  "token" text NOT NULL UNIQUE,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "csat_surveys_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade,
  CONSTRAINT "csat_surveys_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE cascade,
  CONSTRAINT "csat_surveys_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_csat_surveys_tenant" ON "csat_surveys" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_csat_ticket" ON "csat_surveys" ("ticket_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_csat_contact" ON "csat_surveys" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_csat_token" ON "csat_surveys" ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_csat_responded" ON "csat_surveys" ("responded_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canned_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "category" text DEFAULT 'general' NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "shortcut" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid,
  "updated_by" uuid,
  "deleted_by" uuid,
  CONSTRAINT "canned_responses_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canned_responses_tenant" ON "canned_responses" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canned_shortcut" ON "canned_responses" ("tenant_id", "shortcut");
