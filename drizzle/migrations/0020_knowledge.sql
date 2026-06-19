CREATE TABLE IF NOT EXISTS "kb_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "icon" text DEFAULT 'Book',
  "order" integer DEFAULT 0,
  "parent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_categories_tenant" ON "kb_categories" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_categories_active" ON "kb_categories" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_categories_slug" ON "kb_categories" ("tenant_id", "slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "category_id" uuid REFERENCES "kb_categories"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "content" text NOT NULL,
  "excerpt" text,
  "status" text NOT NULL DEFAULT 'draft',
  "views" integer DEFAULT 0,
  "helpful" integer DEFAULT 0,
  "not_helpful" integer DEFAULT 0,
  "tags" text[] DEFAULT '{}',
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid,
  "published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_articles_tenant" ON "kb_articles" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_articles_category" ON "kb_articles" ("category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_articles_status" ON "kb_articles" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_articles_slug" ON "kb_articles" ("tenant_id", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_articles_metadata_g" ON "kb_articles" USING gin ("metadata");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kb_articles_active" ON "kb_articles" ("id") WHERE "deleted_at" IS NULL;
