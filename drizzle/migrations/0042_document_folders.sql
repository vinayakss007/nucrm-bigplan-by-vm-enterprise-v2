CREATE TABLE IF NOT EXISTS "document_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "parent_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_folders_tenant" ON "document_folders" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_folders_parent" ON "document_folders" ("tenant_id", "parent_id");
