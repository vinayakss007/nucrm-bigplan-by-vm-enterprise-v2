CREATE TABLE IF NOT EXISTS "user_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "counters" jsonb DEFAULT '{}'::jsonb,
  "storage_bytes" bigint DEFAULT 0,
  "api_calls_today" integer DEFAULT 0,
  "api_calls_date" date DEFAULT CURRENT_DATE,
  "ai_tokens_today" integer DEFAULT 0,
  "ai_tokens_date" date DEFAULT CURRENT_DATE,
  "last_activity_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_usage_unique" ON "user_usage" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_usage_tenant" ON "user_usage" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id" text NOT NULL UNIQUE,
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
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
