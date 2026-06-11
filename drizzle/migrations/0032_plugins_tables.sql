-- Migration: Plugins group tables (custom_plugins, plugin_execution_logs)

CREATE TABLE IF NOT EXISTS "custom_plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"base_url" text NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb,
	"custom_headers" jsonb DEFAULT '{}'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"webhook_secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "plugin_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plugin_id" uuid NOT NULL,
	"action_name" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"request_headers" jsonb DEFAULT '{}'::jsonb,
	"request_body" jsonb,
	"response_status" integer,
	"response_body" text,
	"duration_ms" integer,
	"success" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_plugins_user_id_users_id_fk') THEN
    ALTER TABLE "custom_plugins" ADD CONSTRAINT "custom_plugins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plugin_execution_logs_plugin_id_custom_plugins_id_fk') THEN
    ALTER TABLE "plugin_execution_logs" ADD CONSTRAINT "plugin_execution_logs_plugin_id_custom_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."custom_plugins"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_tenant" ON "custom_plugins" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_metadata_g" ON "custom_plugins" USING gin ("metadata");
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_active" ON "custom_plugins" USING btree ("id") WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_user" ON "custom_plugins" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_custom_plugins_status" ON "custom_plugins" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_plugin_execution_logs_tenant" ON "plugin_execution_logs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_plugin_execution_logs_plugin" ON "plugin_execution_logs" USING btree ("plugin_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_plugin_execution_logs_success" ON "plugin_execution_logs" USING btree ("tenant_id","success");
