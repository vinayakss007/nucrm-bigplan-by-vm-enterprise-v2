-- Migration: Templates group tables (product_templates, tenant_templates)

CREATE TABLE IF NOT EXISTS "product_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"description" text,
	"icon" text,
	"modules" jsonb DEFAULT '[]'::jsonb,
	"custom_fields" jsonb DEFAULT '[]'::jsonb,
	"pipelines" jsonb DEFAULT '[]'::jsonb,
	"automations" jsonb DEFAULT '[]'::jsonb,
	"is_builtin" boolean DEFAULT false,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"tenant_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_templates_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "tenant_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now(),
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_templates_created_by_users_id_fk') THEN
    ALTER TABLE "product_templates" ADD CONSTRAINT "product_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_templates_template_id_product_templates_id_fk') THEN
    ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_template_id_product_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."product_templates"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_templates_applied_by_users_id_fk') THEN
    ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_product_templates_slug" ON "product_templates" USING btree ("slug");
CREATE INDEX IF NOT EXISTS "idx_product_templates_status" ON "product_templates" USING btree ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_templates_unique" ON "tenant_templates" USING btree ("tenant_id","template_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_templates_tenant" ON "tenant_templates" USING btree ("tenant_id");
