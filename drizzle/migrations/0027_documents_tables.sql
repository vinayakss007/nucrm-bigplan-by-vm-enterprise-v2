-- Migration: Documents group tables (document_folders)

CREATE TABLE IF NOT EXISTS "document_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_document_folders_tenant" ON "document_folders" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_document_folders_parent" ON "document_folders" USING btree ("tenant_id","parent_id");
