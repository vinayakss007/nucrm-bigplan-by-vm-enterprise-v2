CREATE TABLE IF NOT EXISTS "token_budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service" text NOT NULL,
  "monthly_budget_cents" bigint NOT NULL DEFAULT 0,
  "current_month_cents" bigint NOT NULL DEFAULT 0,
  "alert_at_50pct" boolean DEFAULT true,
  "alert_at_80pct" boolean DEFAULT true,
  "alert_at_100pct" boolean DEFAULT true,
  "hard_cap_enabled" boolean DEFAULT true,
  "soft_cap_enabled" boolean DEFAULT true,
  "billing_period" text NOT NULL,
  "reset_day" integer DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_token_budgets_service_period" ON "token_budgets" ("service", "billing_period");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_token_budgets_service" ON "token_budgets" ("service", "billing_period");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_token_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL UNIQUE REFERENCES "tenants"("id") ON DELETE CASCADE,
  "openai_monthly_limit" bigint DEFAULT -1,
  "whatsapp_monthly_msgs" bigint DEFAULT -1,
  "voice_monthly_mins" bigint DEFAULT -1,
  "content_monthly_gen" bigint DEFAULT -1,
  "proposal_monthly_gen" bigint DEFAULT -1,
  "followup_monthly_cnt" bigint DEFAULT -1,
  "score_monthly_cnt" bigint DEFAULT -1,
  "total_monthly_cost" bigint DEFAULT -1,
  "hard_cap_action" text DEFAULT 'block',
  "override_reason" text,
  "set_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_token_limits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "module" text NOT NULL,
  "daily_limit" bigint DEFAULT -1,
  "monthly_limit" bigint DEFAULT -1,
  "max_cost_per_call" bigint DEFAULT -1,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_token_limits_tenant" ON "user_token_limits" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_token_limits_unique" ON "user_token_limits" ("tenant_id", "user_id", "module");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service" text NOT NULL,
  "key_name" text NOT NULL,
  "encrypted_key" text NOT NULL,
  "key_prefix" text,
  "is_active" boolean DEFAULT true,
  "is_primary" boolean DEFAULT false,
  "monthly_budget_cents" bigint DEFAULT -1,
  "current_month_cents" bigint DEFAULT 0,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "rate_limit_per_min" integer,
  "rate_limit_per_day" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_reg_service" ON "api_keys_registry" ("service", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_type" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "service" text,
  "current_value" bigint,
  "threshold_value" bigint,
  "message" text,
  "notification_sent" text,
  "acknowledged" boolean DEFAULT false,
  "acknowledged_by" uuid REFERENCES "users"("id"),
  "acknowledged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_alerts_target" ON "usage_alerts" ("target_type", "target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_alerts_unacked" ON "usage_alerts" ("acknowledged");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_anomalies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "service" text NOT NULL,
  "expected_daily_cents" bigint,
  "actual_daily_cents" bigint,
  "deviation_pct" numeric(10,2),
  "suspected_cause" text,
  "action_taken" text,
  "reviewed" boolean DEFAULT false,
  "reviewed_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cost_anomalies_tenant" ON "cost_anomalies" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_cost_anomalies_unreviewed" ON "cost_anomalies" ("reviewed");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL UNIQUE,
  "client_secret" text NOT NULL,
  "name" text NOT NULL,
  "redirect_uris" text NOT NULL,
  "is_active" boolean DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_clients_client_id" ON "oauth_clients" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_clients_tenant" ON "oauth_clients" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" uuid REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "code" text NOT NULL UNIQUE,
  "redirect_uri" text NOT NULL,
  "scope" text,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_codes_code" ON "oauth_codes" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_codes_client" ON "oauth_codes" ("client_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" uuid REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "access_token" text NOT NULL UNIQUE,
  "refresh_token" text UNIQUE,
  "scope" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_tokens_access" ON "oauth_tokens" ("access_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_refresh" ON "oauth_tokens" ("refresh_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_client" ON "oauth_tokens" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_user" ON "oauth_tokens" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "access_token" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "is_active" boolean DEFAULT true,
  "last_login_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_portal_clients_tenant" ON "portal_clients" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_portal_clients_email" ON "portal_clients" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_portal_clients_token" ON "portal_clients" ("access_token");
