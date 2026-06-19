CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT 'Default',
  "layout" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_default" boolean DEFAULT false,
  "source" text NOT NULL DEFAULT 'user',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboard_layouts_tenant" ON "dashboard_layouts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboard_layouts_user_default" ON "dashboard_layouts" ("user_id", "is_default");
