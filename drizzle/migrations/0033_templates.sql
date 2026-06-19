CREATE TABLE IF NOT EXISTS "product_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text UNIQUE,
  "description" text,
  "icon" text,
  "modules" jsonb DEFAULT '[]'::jsonb,
  "custom_fields" jsonb DEFAULT '[]'::jsonb,
  "pipelines" jsonb DEFAULT '[]'::jsonb,
  "automations" jsonb DEFAULT '[]'::jsonb,
  "is_builtin" boolean DEFAULT false,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "tenant_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_templates_slug" ON "product_templates" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_templates_status" ON "product_templates" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "template_id" uuid NOT NULL REFERENCES "product_templates"("id") ON DELETE CASCADE,
  "applied_at" timestamp with time zone DEFAULT now(),
  "applied_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_templates_unique" ON "tenant_templates" ("tenant_id", "template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_templates_tenant" ON "tenant_templates" ("tenant_id");
