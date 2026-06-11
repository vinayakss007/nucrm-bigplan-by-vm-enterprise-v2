-- Migration: Usage group tables (plan_limits, user_usage)

CREATE TABLE IF NOT EXISTS "plan_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" text NOT NULL,
	"max_users" integer,
	"max_contacts" integer,
	"max_deals" integer,
	"max_storage_bytes" bigint,
	"max_api_calls_per_day" integer,
	"max_ai_tokens_per_day" integer,
	"max_emails_per_day" integer,
	"max_active_automations" integer,
	"max_tickets" integer,
	"max_forms" integer,
	"max_custom_fields_per_entity" integer,
	"max_file_upload_bytes" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "plan_limits_plan_id_unique" UNIQUE("plan_id")
);

CREATE TABLE IF NOT EXISTS "user_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"counters" jsonb DEFAULT '{}'::jsonb,
	"storage_bytes" bigint DEFAULT 0,
	"api_calls_today" integer DEFAULT 0,
	"api_calls_date" date DEFAULT CURRENT_DATE,
	"ai_tokens_today" integer DEFAULT 0,
	"ai_tokens_date" date DEFAULT CURRENT_DATE,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_usage_user_id_users_id_fk') THEN
    ALTER TABLE "user_usage" ADD CONSTRAINT "user_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_usage_unique" ON "user_usage" USING btree ("tenant_id","user_id");
CREATE INDEX IF NOT EXISTS "idx_user_usage_tenant" ON "user_usage" USING btree ("tenant_id");
