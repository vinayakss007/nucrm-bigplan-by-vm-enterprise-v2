CREATE TABLE IF NOT EXISTS "custom_plugins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "icon" text,
  "base_url" text NOT NULL,
  "auth_type" text NOT NULL DEFAULT 'none',
  "auth_config" jsonb DEFAULT '{}'::jsonb,
  "custom_headers" jsonb DEFAULT '{}'::jsonb,
  "actions" jsonb DEFAULT '[]'::jsonb,
  "webhook_secret" text,
  "status" text NOT NULL DEFAULT 'active',
  "last_used_at" timestamp with time zone,
  "last_error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_tenant" ON "custom_plugins" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_metadata_g" ON "custom_plugins" USING gin ("metadata");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_active" ON "custom_plugins" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_user" ON "custom_plugins" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_status" ON "custom_plugins" ("tenant_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_execution_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "plugin_id" uuid NOT NULL REFERENCES "custom_plugins"("id") ON DELETE CASCADE,
  "action_name" text NOT NULL,
  "method" text NOT NULL,
  "url" text NOT NULL,
  "request_headers" jsonb DEFAULT '{}'::jsonb,
  "request_body" jsonb,
  "response_status" integer,
  "response_body" text,
  "duration_ms" integer,
  "success" boolean NOT NULL DEFAULT false,
  "error_message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plugin_execution_logs_tenant" ON "plugin_execution_logs" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plugin_execution_logs_plugin" ON "plugin_execution_logs" ("plugin_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plugin_execution_logs_success" ON "plugin_execution_logs" ("tenant_id", "success");
