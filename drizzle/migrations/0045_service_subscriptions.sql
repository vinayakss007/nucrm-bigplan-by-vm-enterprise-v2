CREATE TABLE IF NOT EXISTS "service_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "service_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "start_date" timestamp with time zone DEFAULT now(),
  "end_date" timestamp with time zone,
  "auto_renew" boolean DEFAULT true,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_service_subscriptions_tenant" ON "service_subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "entity_type" text NOT NULL,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "columns" jsonb,
  "is_shared" boolean DEFAULT false,
  "is_default" boolean DEFAULT false,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_views_tenant" ON "saved_views" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_views_entity_tenant" ON "saved_views" ("entity_type", "tenant_id");
