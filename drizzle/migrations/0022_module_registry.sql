CREATE TABLE IF NOT EXISTS "modules" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "version" text NOT NULL DEFAULT '1.0.0',
  "description" text,
  "category" text,
  "icon" text,
  "is_available" text DEFAULT 'false',
  "manifest" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_modules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "module_id" text NOT NULL REFERENCES "modules"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'active',
  "enabled_features" jsonb DEFAULT '[]'::jsonb,
  "force_enabled" boolean DEFAULT false,
  "settings" jsonb DEFAULT '{}'::jsonb,
  "installed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "installed_at" timestamp with time zone DEFAULT now(),
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_modules_unique" ON "tenant_modules" ("tenant_id", "module_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_modules_tenant" ON "tenant_modules" ("tenant_id");
